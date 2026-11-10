import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyEstimateLevel, createPackageEntry, emptyPackageLabel, syncPackageEntry, calculateNutrients, createFoodEntry, createEstimatedFoodEntry, findFood, type Backup, type MealRecord } from '@shike/shared'
import { ShikeDatabase, exportBackup, loadData, parseBackup, restoreBackup, saveMeal, saveSettings, saveWeight } from '../src/lib/db'
import { recognitionEstimate, matchedEntry } from '../src/lib/entries'
import { porridgeProfile } from './range-fixture'

let database: ShikeDatabase
const sample = (): MealRecord => ({ id: 'meal-1', date: '2026-10-14', mealType: 'lunch', mode: 'manual', createdAt: '2026-10-14T04:00:00.000Z', updatedAt: '2026-10-14T04:00:00.000Z', items: [createFoodEntry(findFood('米饭')!, 150)] })
beforeEach(() => { database = new ShikeDatabase(`shike-test-${crypto.randomUUID()}`) })
afterEach(async () => { await database.delete() })

describe('本地记录与备份', () => {
  it('另一标签页在读取餐食后整体更新时，餐食和体重仍来自同一份快照', async () => {
    const meal = sample()
    const weight = { date: meal.date, weightKg: 70, updatedAt: meal.updatedAt }
    await database.meals.put(meal); await database.weights.put(weight)
    let competingWrite: Promise<void> | undefined
    // 在第一笔读取事务建立后，插入另一标签页的原生事务；不替换任何读取结果。
    database.use({ stack: 'dbcore', name: 'concurrent-tab', create: down => ({
      ...down,
      transaction(stores, mode, options) {
        const transaction = down.transaction(stores, mode, options)
        if (!competingWrite && mode === 'readonly' && stores.includes('meals')) {
          competingWrite = new Promise<void>((resolve, reject) => {
            const write = database.backendDB().transaction(['meals', 'weights'], 'readwrite')
            write.oncomplete = () => resolve()
            write.onabort = () => reject(write.error)
            write.objectStore('meals').put({ ...meal, items: [{ ...meal.items[0], weightG: 200 }] })
            write.objectStore('weights').put({ ...weight, weightKg: 68 })
          })
        }
        return transaction
      },
    }) })
    database.close(); await database.open()
    const data = await loadData(database)
    await competingWrite
    expect(data.meals[0]!.items[0]!.weightG).toBe(150)
    expect(data.weights[0]!.weightKg).toBe(70)
    expect((await database.weights.get(meal.date))!.weightKg).toBe(68)
  })

  it('包装标签快照事务保存和恢复，模拟来源不能隐藏，也不进入AI个人库', async () => {
    const entry = createPackageEntry('测试包装', { ...emptyPackageLabel(), basis: '100ml', energy: { value: 250, unit: 'kJ' }, netContent: { amount: 250, unit: 'ml' } }, 'mock', 'label-test')
    entry.packageSnapshot!.consumedUnit = 'package'; entry.packageSnapshot!.consumedAmount = 0.5; syncPackageEntry(entry)
    await saveMeal({ ...sample(), mode: 'live', items: [entry] }, database)
    const data = await loadData(database); expect(data.meals[0]!.mode).toBe('mock'); expect(data.estimatedFoods).toEqual([])
    const backup = await exportBackup(database); expect(backup.schemaVersion).toBe(11)
    await database.meals.clear(); await restoreBackup(backup, database)
    const restored = (await loadData(database)).meals[0]!.items[0]!
    expect(restored.weightG).toBeNull(); expect(restored.packageSnapshot!.label.energy!.unit).toBe('kJ'); expect(calculateNutrients(restored).energyKcal).toBeCloseTo(312.5 / 4.184)
  })
  it('保存独立营养快照，后续修改草稿不改写历史', async () => {
    const record = sample()
    await saveMeal(record, database)
    record.items[0]!.weightG = 999
    record.items[0]!.nutrientsPer100g.energyKcal = 1
    const saved = (await loadData(database)).meals[0]!
    expect(saved.items[0]!.weightG).toBe(150)
    expect(saved.items[0]!.nutrientsPer100g.energyKcal).not.toBe(1)
  })
  it('同一日期的体重只更新一条记录', async () => {
    await saveWeight({ date: '2026-10-14', weightKg: 70, updatedAt: '2026-10-14T04:00:00.000Z' }, database)
    await saveWeight({ date: '2026-10-14', weightKg: 69.8, updatedAt: '2026-10-14T05:00:00.000Z' }, database)
    expect((await loadData(database)).weights).toHaveLength(1)
    expect((await loadData(database)).weights[0]!.weightKg).toBe(69.8)
  })
  it('不接受无名食物，验证失败不写入数据库', async () => {
    const record = sample(); record.items[0]!.name = ''
    await expect(saveMeal(record, database)).rejects.toThrow()
    expect(await database.meals.count()).toBe(0)
  })
  it('导出恢复保留饮食、体重、目标和模拟标识', async () => {
    const record = sample(); record.mode = 'mock'
    await saveMeal(record, database)
    await saveWeight({ date: '2026-10-14', weightKg: 70, updatedAt: '2026-10-14T04:00:00.000Z' }, database)
    await saveSettings({ targetWeightKg: 65 }, database)
    const backup = parseBackup(JSON.stringify(await exportBackup(database)))
    await database.meals.clear(); await database.weights.clear()
    await restoreBackup(backup, database)
    const data = await loadData(database)
    expect(data.meals[0]!.mode).toBe('mock')
    expect(data.weights[0]!.weightKg).toBe(70)
    expect(data.settings.targetWeightKg).toBe(65)
    expect(JSON.stringify(backup)).not.toContain('image')
  })
  it('拒绝重复主键和额外密钥字段，不会静默覆盖或接受秘密', async () => {
    const backup = await exportBackup(database)
    expect(() => parseBackup(JSON.stringify({ ...backup, meals: [sample(), sample()] }))).toThrow('备份内容无效')
    expect(() => parseBackup(JSON.stringify({ ...backup, apiKey: 'not-allowed' }))).toThrow('备份内容无效')
  })
  it('完整恢复写入失败时，事务回滚保留之前的数据', async () => {
    await saveMeal(sample(), database)
    const restore: Backup = { schemaVersion: 11, mealPhotos: [], libraryFoods: [], packagedFoods: [], water: [], exercises: [], dailyPlans: [], estimatedFoods: [], exportedAt: '2026-10-14T04:00:00.000Z', meals: [], weights: [{ date: '2026-10-13', weightKg: 75, updatedAt: '2026-10-14T04:00:00.000Z' }], settings: { targetWeightKg: 65 } }
    database.weights.hook('creating', () => { throw new Error('模拟存储已满') })
    await expect(restoreBackup(restore, database)).rejects.toThrow('模拟存储已满')
    expect(await database.meals.count()).toBe(1)
    expect(await database.weights.count()).toBe(0)
  })
})

const aiMeal = (provider: 'gemini' | 'mock' = 'gemini', energyKcal = 50, name = '杂粮粥'): MealRecord => {
  const estimate = recognitionEstimate(name, { energyKcal, proteinG: 1.4, fatG: 0.6, carbsG: 10 }, ['假设无糖、清水煮的稀粥；实际含水量未知。'], provider, 'test-vision-model')!
  return { ...sample(), id: crypto.randomUUID(), mode: provider === 'mock' ? 'mock' : 'live', items: [createEstimatedFoodEntry(estimate, 200)] }
}

describe('个人 AI 估算库与确认保存', () => {
  it('候选草稿不写库，确认保存才与饮食一起写入', async () => {
    const record = aiMeal()
    expect(await database.estimatedFoods.count()).toBe(0)
    await saveMeal(record, database)
    const data = await loadData(database)
    expect(data.estimatedFoods).toHaveLength(1)
    expect(data.estimatedFoods[0]!.provider).toBe('gemini')
    expect(data.estimatedFoods[0]!.assumptions[0]).toContain('含水量未知')
    expect(data.meals[0]!.items[0]!.referenceId).toBe(data.estimatedFoods[0]!.id)
  })
  it('模拟估算可保存记录，但永远不进入真实个人估算库', async () => {
    const record = aiMeal('mock'); record.mode = 'live'
    await saveMeal(record, database)
    expect(await database.estimatedFoods.count()).toBe(0)
    expect((await database.meals.get(record.id))!.mode).toBe('mock')
  })
  it.each(['ai', 'manual'] as const)('恢复 %s 条目不一致的 live 标记时依据 Mock 快照纠正，且不额外生成个人估算', async (kind) => {
    const meal = aiMeal('mock'); meal.mode = 'live'
    meal.items[0]!.kind = kind
    const backup: Backup = { schemaVersion: 11, mealPhotos: [], libraryFoods: [], packagedFoods: [], water: [], exercises: [], dailyPlans: [], exportedAt: '2026-10-14T04:00:00.000Z', meals: [meal], weights: [], settings: { targetWeightKg: null }, estimatedFoods: [] }
    await restoreBackup(backup, database)
    const restored = (await loadData(database)).meals[0]!
    expect(restored.mode).toBe('mock')
    expect(restored.items[0]!.aiEstimateSnapshot!.provider).toBe('mock')
    expect(await database.estimatedFoods.count()).toBe(0)
  })
  it('数据库和手动记录不会加入 AI 估算库', async () => {
    const record = sample(); record.mode = 'live'
    await saveMeal(record, database)
    expect(await database.estimatedFoods.count()).toBe(0)
  })
  it('同规范化名称更新一条估算并保留 ID，旧饮食快照不改写', async () => {
    const first = aiMeal('gemini', 50)
    await saveMeal(first, database)
    const before = (await database.estimatedFoods.toArray())[0]!
    const next = aiMeal('gemini', 60, ' 杂粮粥 ')
    await saveMeal(next, database)
    const after = (await database.estimatedFoods.toArray())[0]!
    expect(await database.estimatedFoods.count()).toBe(1)
    expect(after.id).toBe(before.id)
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.nutrientsPer100g.energyKcal).toBe(60)
    expect((await database.meals.get(first.id))!.items[0]!.nutrientsPer100g.energyKcal).toBe(50)
  })
  it('饮食写入失败时，个人估算新建或更新一起回滚', async () => {
    await saveMeal(aiMeal(), database)
    const before = (await database.estimatedFoods.toArray())[0]!
    database.meals.hook('creating', () => { throw new Error('模拟饮食写入失败') })
    await expect(saveMeal(aiMeal('gemini', 99), database)).rejects.toThrow('模拟饮食写入失败')
    expect(await database.meals.count()).toBe(1)
    expect((await database.estimatedFoods.toArray())[0]!.nutrientsPer100g.energyKcal).toBe(before.nutrientsPer100g.energyKcal)
  })
  it('v2 导出恢复包含个人估算，恢复失败保留原估算', async () => {
    await saveMeal(aiMeal(), database)
    const backup = await exportBackup(database)
    expect(backup.schemaVersion).toBe(11)
    expect(backup.estimatedFoods).toHaveLength(1)
    await database.estimatedFoods.clear()
    await restoreBackup(backup, database)
    expect(await database.estimatedFoods.count()).toBe(1)
    database.preferences.hook('creating', () => { throw new Error('模拟恢复后段失败') })
    await expect(restoreBackup({ ...backup, estimatedFoods: [] }, database)).rejects.toThrow('模拟恢复后段失败')
    expect(await database.estimatedFoods.count()).toBe(1)
  })
  it('旧 v1 JSON 自动转换成 v2，个人估算库为空', async () => {
    const old = { schemaVersion: 1, exportedAt: '2026-10-14T04:00:00.000Z', meals: [sample()], weights: [], settings: { targetWeightKg: null } }
    const converted = parseBackup(JSON.stringify(old))
    expect(converted.schemaVersion).toBe(11)
    expect(converted.estimatedFoods).toEqual([])
    await restoreBackup(converted, database)
    expect(await database.meals.count()).toBe(1)
  })
  it('IndexedDB v1 升级到 v2 保留原有饮食', async () => {
    await database.delete()
    const old = new Dexie(database.name)
    old.version(1).stores({ meals: 'id,date,mealType', weights: 'date', preferences: 'id' })
    await old.table('meals').put(sample())
    old.close()
    database = new ShikeDatabase(database.name)
    const data = await loadData(database)
    expect(data.meals).toHaveLength(1)
    expect(data.estimatedFoods).toEqual([])
  })
  it('区间、选档与中值在个人库和备份中保留，后续更新不重算历史', async () => {
    const profile = recognitionEstimate('杂粮粥', null, [], 'gemini', 'range-model', porridgeProfile)!
    const low = { ...aiMeal(), items: [applyEstimateLevel(createEstimatedFoodEntry(profile, 300), 'low')] }
    await saveMeal(low, database)
    const high = { ...aiMeal(), items: [applyEstimateLevel(createEstimatedFoodEntry(profile, 300), 'high')] }
    await saveMeal(high, database)
    const backup = parseBackup(JSON.stringify(await exportBackup(database)))
    expect(backup.estimatedFoods[0]!.estimateProfile).toEqual(porridgeProfile)
    expect(backup.estimatedFoods[0]!.estimateLevel).toBe('high')
    expect(backup.estimatedFoods[0]!.nutrientsPer100g.energyKcal).toBe(105)
    expect(backup.meals.find(meal => meal.id === low.id)!.items[0]!.nutrientsPer100g.energyKcal).toBe(50)
    await restoreBackup(backup, database)
    expect((await database.meals.get(low.id))!.items[0]!.estimateLevel).toBe('low')
    expect((await database.meals.get(low.id))!.items[0]!.estimateProfile).toEqual(porridgeProfile)
  })
  it('旧个人单值被新识别三档升级时保持库 ID，并保留旧餐食单值快照', async () => {
    const oldMeal = aiMeal('gemini', 50)
    await saveMeal(oldMeal, database)
    const oldLibrary = await database.estimatedFoods.toArray()
    const current = recognitionEstimate('杂粮粥', null, [], 'gemini', 'new-range-model', porridgeProfile)!
    const nextEntry = matchedEntry('杂粮粥', 300, oldLibrary, current)
    expect(nextEntry.estimateProfile).toEqual(porridgeProfile)
    const nextMeal = { ...aiMeal(), items: [nextEntry] }
    await saveMeal(nextMeal, database)
    const upgraded = await database.estimatedFoods.toArray()
    expect(upgraded).toHaveLength(1)
    expect(upgraded[0]!.id).toBe(oldLibrary[0]!.id)
    expect(upgraded[0]!.createdAt).toBe(oldLibrary[0]!.createdAt)
    expect(upgraded[0]!.estimateProfile).toEqual(porridgeProfile)
    expect(upgraded[0]!.nutrientsPer100g.energyKcal).toBe(75)
    const history = (await database.meals.get(oldMeal.id))!.items[0]!
    expect(history.estimateProfile).toBeUndefined()
    expect(history.nutrientsPer100g.energyKcal).toBe(50)
  })
})
