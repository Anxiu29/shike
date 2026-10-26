import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { calorieBudget, createExercise, defaultDailyGoals, type Settings, type WaterRecord } from '@shike/shared'
import { ShikeDatabase, exportBackup, loadData, parseBackup, restoreBackup, saveExercise, saveSettings, saveWater, saveWeight, deleteWeight } from '../src/lib/db'

let database: ShikeDatabase
const now = '2026-10-14T10:00:00.000Z'
const preferences: Settings = { targetWeightKg: 65, personalInfo: { sex: 'male', age: 30, heightCm: 175, startingWeightKg: 70, startingDate: '2026-10-14', activityLevel: 'sedentary', autoEstimateAllowed: true }, dailyGoals: { ...defaultDailyGoals, purpose: 'lose', waterMl: 1800, exerciseMinutes: 30 } }
const water = (id = 'water-1', date = '2026-10-14'): WaterRecord => ({ id, date, amountMl: 250, createdAt: now, updatedAt: now })
beforeEach(() => { database = new ShikeDatabase(`wellness-${crypto.randomUUID()}`) })
afterEach(async () => { await database.delete() })

describe('个人目标、饮水与运动持久化', () => {
  it('按字段合并个人资料和目标，旧页面不覆盖其它页面刚保存的值', async () => {
    await saveSettings(preferences, database, '2026-10-14')
    await saveSettings({ targetWeightKg: 64, dailyGoals: { waterMl: 2000 } }, database, '2026-10-15')
    await saveSettings({ personalInfo: { heightCm: 180 } }, database, '2026-10-15')
    const data = await loadData(database)
    expect(data.settings.targetWeightKg).toBe(64)
    expect(data.settings.personalInfo).toEqual({ ...preferences.personalInfo, heightCm: 180 })
    expect(data.settings.dailyGoals).toEqual({ ...preferences.dailyGoals, waterMl: 2000 })
    expect(data.dailyPlans.find(plan => plan.date === '2026-10-14')!.settingsSnapshot).toEqual(preferences)
    expect(data.dailyPlans.find(plan => plan.date === '2026-10-15')!.settingsSnapshot).toEqual(data.settings)
    const restored = parseBackup(JSON.stringify(await exportBackup(database)))
    expect(restored.settings).toEqual(data.settings)
  })
  it('不完整的新个人资料及无效补丁不写库，原有设置和预算一起保留', async () => {
    await expect(saveSettings({ personalInfo: { heightCm: 180 } }, database)).rejects.toThrow()
    expect(await database.preferences.count()).toBe(0)
    await saveSettings(preferences, database, '2026-10-14')
    await expect(saveSettings({ personalInfo: { heightCm: -1 } }, database, '2026-10-14')).rejects.toThrow()
    expect((await loadData(database)).settings).toEqual(preferences)
    expect((await database.dailyPlans.get('2026-10-14'))!.settingsSnapshot).toEqual(preferences)
  })
  it('全天汇总同日只保存一条，更新原值并完整导入恢复', async () => {
    const input = { date: '2026-10-14', manualScope: 'day' as const, deviceReading: 'active' as const, manualActiveKcal: 500, dayBudgetKcal: 120, includeInBudget: true };
    const daily = createExercise(input); await saveExercise(daily, database); await expect(saveExercise(createExercise(input), database)).rejects.toThrow('当天已有'); expect(await database.exercises.count()).toBe(1);
    await saveExercise(createExercise({ ...input, manualActiveKcal: 650, dayBudgetKcal: 180 }, daily), database); expect((await database.exercises.get(daily.id))!.activeKcal).toBe(650);
    const backup = parseBackup(JSON.stringify(await exportBackup(database))); await database.exercises.clear(); await restoreBackup(backup, database); expect((await database.exercises.get(daily.id))!.minutes).toBeNull(); expect((await database.exercises.get(daily.id))!.dayBudgetKcal).toBe(180);
  })
  it('俯卧撑保留次数和节奏快照，v8往返及v6迁移可用，改体重不重算旧运动', async () => {
    const record = createExercise({ date: '2026-10-14', activityCode: '02022', count: 30, weightKg: 70, includeInBudget: true }); await saveExercise(record, database);
    await saveWeight({ date: record.date, weightKg: 90, updatedAt: now }, database); expect((await database.exercises.get(record.id))!.activeKcal).toBeCloseTo(4.9);
    const backup = parseBackup(JSON.stringify(await exportBackup(database))); expect(backup.schemaVersion).toBe(11); expect(backup.exercises[0]!.repetitionSnapshot!.count).toBe(30);
    await database.exercises.clear(); await restoreBackup(backup, database); expect((await database.exercises.get(record.id))!.repetitionSnapshot!.secondsPerRep).toBe(3);
    expect(parseBackup(JSON.stringify({ ...backup, mealPhotos: undefined, libraryFoods: undefined, schemaVersion: 6, exercises: [] })).schemaVersion).toBe(11);
    expect(() => parseBackup(JSON.stringify({ ...backup, exercises: [{ ...record, minutes: 300 }] }))).toThrow();
  })
  it('升级旧 IndexedDB v2 保留全部旧表，新增记录表为空', async () => {
    await database.delete()
    const old = new Dexie(database.name)
    old.version(2).stores({ meals: 'id,date,mealType', weights: 'date', preferences: 'id', estimatedFoods: 'id,name' })
    await old.table('preferences').put({ id: 'preferences', value: { targetWeightKg: 60 } }); old.close()
    database = new ShikeDatabase(database.name)
    const data = await loadData(database)
    expect(data.settings.targetWeightKg).toBe(60); expect(data.water).toEqual([]); expect(data.exercises).toEqual([])
  })
  it('体重页只改目标时保留个人资料，设置修改只更新指定今日，旧预算不变', async () => {
    await saveSettings(preferences, database, '2026-10-14')
    await saveWater(water(), database)
    await saveSettings({ targetWeightKg: 64, dailyGoals: { ...preferences.dailyGoals!, adjustmentKcal: 400 } }, database, '2026-10-15')
    const data = await loadData(database)
    expect(data.settings.personalInfo).toEqual(preferences.personalInfo)
    expect(calorieBudget(data.dailyPlans.find(p => p.date === '2026-10-14')!, [], 0).base).toBeCloseTo(2108.25)
    expect(calorieBudget(data.dailyPlans.find(p => p.date === '2026-10-15')!, [], 0).base).toBeCloseTo(1908.25)
  })
  it('体重变化只更新称重当日预算，运动的已存热量与体重快照保留', async () => {
    await saveSettings(preferences, database, '2026-10-14')
    const exercise = createExercise({ date: '2026-10-14', minutes: 30, activityCode: '17170', weightKg: 70, includeInBudget: true })
    await saveExercise(exercise, database)
    await saveWeight({ date: '2026-10-14', weightKg: 72, updatedAt: now }, database)
    expect((await database.dailyPlans.get('2026-10-14'))!.weightKg).toBe(72)
    expect((await database.exercises.get(exercise.id))!.activeKcal).toBe(70)
    await deleteWeight('2026-10-14', database)
    expect((await database.dailyPlans.get('2026-10-14'))!.weightKg).toBe(70)
  })
  it('目标快照写入失败时饮水记录一起回滚，错误数值不写库', async () => {
    database.dailyPlans.hook('creating', () => { throw new Error('snapshot failed') })
    await expect(saveWater(water(), database)).rejects.toThrow('snapshot failed')
    expect(await database.water.count()).toBe(0)
    await expect(saveWater({ ...water(), amountMl: -1 }, database)).rejects.toThrow()
    expect(await database.water.count()).toBe(0)
  })
  it('v8 备份完整往返所有新数据，拒绝重复记录，恢复写入失败全部回滚', async () => {
    await saveSettings(preferences, database, '2026-10-14'); await saveWater(water(), database)
    await saveExercise(createExercise({ date: '2026-10-14', minutes: 30, manualName: '游泳', manualActiveKcal: 150, includeInBudget: false }), database)
    const backup = parseBackup(JSON.stringify(await exportBackup(database)))
    expect(backup.schemaVersion).toBe(11); expect(backup.water).toHaveLength(1); expect(backup.exercises).toHaveLength(1); expect(backup.dailyPlans).toHaveLength(1)
    expect(() => parseBackup(JSON.stringify({ ...backup, water: [backup.water[0], backup.water[0]] }))).toThrow()
    expect(() => parseBackup(JSON.stringify({ ...backup, dailyPlans: [backup.dailyPlans[0], backup.dailyPlans[0]] }))).toThrow()
    await database.water.clear(); await database.exercises.clear(); await restoreBackup(backup, database)
    expect((await loadData(database)).water).toHaveLength(1)
    database.preferences.hook('creating', () => { throw new Error('disk full') })
    await expect(restoreBackup({ ...backup, water: [], exercises: [] }, database)).rejects.toThrow('disk full')
    expect(await database.water.count()).toBe(1); expect(await database.exercises.count()).toBe(1)
  })
  it('旧 v2 备份补空数组，按完整替换语义清除新数据，不凭空创建历史目标', async () => {
    await saveWater(water(), database)
    const old = parseBackup(JSON.stringify({ schemaVersion: 2, exportedAt: now, meals: [], weights: [], estimatedFoods: [], settings: { targetWeightKg: 60 } }))
    expect(old.water).toEqual([]); expect(old.dailyPlans).toEqual([])
    await restoreBackup(old, database)
    expect(await database.water.count()).toBe(0); expect((await loadData(database)).settings.targetWeightKg).toBe(60)
  })
})
