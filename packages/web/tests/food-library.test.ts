import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyEstimateLevel, backupSchema, calculateNutrients, createEstimatedFoodEntry, createFoodEntry, findFood, type FoodEntry } from '@shike/shared'
import { ShikeDatabase, exportBackup, loadData, restoreBackup, saveLibraryFood, saveLibraryFoods, toggleFoodFavorite } from '../src/lib/db'
import { copyLibraryEntry, sortedPersonalFoods } from '../src/lib/personal-foods'
import { buildFoodChoices, entryForFoodChoice, searchFoodChoices } from '../src/lib/food-picker'
import { recognitionEstimate } from '../src/lib/entries'
import { porridgeProfile } from './range-fixture'

let database: ShikeDatabase
beforeEach(() => { database = new ShikeDatabase(`food-library-${crypto.randomUUID()}`) })
afterEach(async () => { await database.delete() })
const rice = () => createFoodEntry(findFood('米饭')!, 150)
const ai = () => applyEstimateLevel(createEstimatedFoodEntry(recognitionEstimate('自制红豆粥', null, ['测试情景，非实测'], 'qwen', 'test-model', porridgeProfile)!, 200), 'high')

describe('食品收藏和个人食品快照', () => {
  it('批量存为常用会去重；任何模拟快照失败时整批回滚', async () => {
    const a = rice(), b = ai()
    const saved = await saveLibraryFoods([{ entry: a, origin: 'manual' }, { entry: { ...a, id: 'copy-id' }, origin: 'manual' }, { entry: b, origin: 'ai' }], database)
    expect(saved[0]!.id).toBe(saved[1]!.id)
    expect(await database.libraryFoods.count()).toBe(2)
    const mock = ai(); mock.aiEstimateSnapshot!.provider = 'mock'
    await expect(saveLibraryFoods([{ entry: { ...a, weightG: 321 }, origin: 'manual' }, { entry: mock, origin: 'ai' }], database)).rejects.toThrow()
    expect(await database.libraryFoods.count()).toBe(2)
  })
  it('首页快捷添加保留存库份量、区间和未知值，并隔离本餐修改', async () => {
    const saved = await saveLibraryFood(ai(), 'ai', database)
    const entry = copyLibraryEntry(saved), second = copyLibraryEntry(saved)
    expect(entry.id).not.toBe(second.id)
    expect(entry.weightG).toBe(200)
    expect(entry.estimateProfile).toEqual(saved.entry.estimateProfile)
    expect(entry.estimateLevel).toBe('high')
    entry.nutrientsPer100g.energyKcal = 1
    expect(saved.entry.nutrientsPer100g.energyKcal).toBe(105)
    const unknown = await saveLibraryFood({ ...rice(), weightG: null }, 'manual', database)
    expect(copyLibraryEntry(unknown).weightG).toBeNull()
    const drink = await saveLibraryFood({ id: 'volume-test', name: '自制豆乳', weightG: null, kind: 'manual', nutrientsPer100g: { energyKcal: null, proteinG: null, fatG: null, carbsG: null }, provenance: '用户填写', warnings: [], volumeSnapshot: { amountMl: 250, nutrientsPer100ml: { energyKcal: 60, proteinG: null, fatG: null, carbsG: null } } }, 'manual', database)
    const copiedDrink = copyLibraryEntry(drink)
    expect(copiedDrink.volumeSnapshot?.amountMl).toBe(250)
    expect(calculateNutrients(copiedDrink).energyKcal).toBe(150)
  })
  it('常用排序将星标放在前面，不改写数据或输入数组', async () => {
    const a = await saveLibraryFood(rice(), 'manual', database), b = await saveLibraryFood(ai(), 'ai', database)
    a.favorite = true; a.updatedAt = '2026-01-01T00:00:00.000Z'; b.updatedAt = '2026-10-23T00:00:00.000Z'
    const input = [b, a]
    expect(sortedPersonalFoods(input).map(food => food.id)).toEqual([a.id, b.id])
    expect(input.map(food => food.id)).toEqual([b.id, a.id])
  })
  it('收藏不增加餐食，取消收藏不删除已保存的个人食品，刷新读取一致', async () => {
    const food = rice(); expect(await toggleFoodFavorite(food.referenceId!, food, database)).toBe(true)
    expect((await loadData(database)).meals).toEqual([])
    expect((await loadData(database)).libraryFoods[0]!.favorite).toBe(true)
    expect(await toggleFoodFavorite(food.referenceId!, food, database)).toBe(false)
    expect((await loadData(database)).libraryFoods).toEqual([])
    const own = await saveLibraryFood(ai(), 'ai', database)
    await toggleFoodFavorite(own.choiceId, own.entry, database); await toggleFoodFavorite(own.choiceId, own.entry, database)
    expect((await database.libraryFoods.get(own.id))?.favorite).toBe(false)
  })
  it('AI三档和份量完整保存，重用ID独立，改本餐不会污染个人库', async () => {
    const original = ai(), food = await saveLibraryFood(original, 'ai', database)
    original.nutrientsPer100g.energyKcal = 1
    const stored = await database.libraryFoods.toArray()
    const a = entryForFoodChoice(food.choiceId, null, [], [], stored)!, b = entryForFoodChoice(food.choiceId, null, [], [], stored)!
    expect(a.id).not.toBe(b.id); expect(a.weightG).toBe(200); expect(a.estimateLevel).toBe('high')
    expect(calculateNutrients(a).energyKcal).toBe(210)
    a.nutrientsPer100g.energyKcal = 999
    expect((await database.libraryFoods.get(food.id))!.entry.nutrientsPer100g.energyKcal).toBe(105)
    const changedWeight = entryForFoodChoice(food.choiceId, 100, [], [], stored)!
    expect(calculateNutrients(changedWeight).energyKcal).toBe(105)
    expect(searchFoodChoices(buildFoodChoices([], undefined, undefined, [], stored), '自制红豆粥', '我的食物')[0]!.id).toBe(food.choiceId)
  })
  it('同一快照去重，同名不同做法不覆盖，模拟数据拒绝且事务不留残留', async () => {
    const food = ai(); const first = await saveLibraryFood(food, 'ai', database)
    expect((await saveLibraryFood({ ...food, id: 'different-entry' }, 'ai', database)).id).toBe(first.id)
    await saveLibraryFood(applyEstimateLevel(food, 'low'), 'ai', database)
    const mock = ai(); mock.aiEstimateSnapshot!.provider = 'mock'
    await expect(saveLibraryFood(mock, 'ai', database)).rejects.toThrow()
    expect(await database.libraryFoods.count()).toBe(2)
  })
  it('v10备份往返保存收藏和AI食品，拒绝重复ID，v9恢复为空新库并保留旧数据', async () => {
    const food = await saveLibraryFood(ai(), 'ai', database); await toggleFoodFavorite(food.choiceId, food.entry, database)
    const backup = await exportBackup(database); expect(backup.schemaVersion).toBe(10)
    await database.libraryFoods.clear(); await restoreBackup(backup, database)
    expect((await database.libraryFoods.toArray())[0]!.favorite).toBe(true)
    expect(backupSchema.safeParse({ ...backup, libraryFoods: [...backup.libraryFoods, ...backup.libraryFoods] }).success).toBe(false)
    const { libraryFoods: _new, ...legacy } = backup
    const parsed = backupSchema.parse({ ...legacy, schemaVersion: 9 }); expect(parsed.libraryFoods).toEqual([])
    await restoreBackup(parsed, database); expect(await database.libraryFoods.count()).toBe(0)
  })
  it('从v4原数据库升级保留已有表，不要求卸载或清空', async () => {
    const legacy = new Dexie(database.name)
    legacy.version(4).stores({ meals: 'id,date,mealType', weights: 'date', preferences: 'id', estimatedFoods: 'id,name', water: 'id,date', exercises: 'id,date', dailyPlans: 'date', packagedFoods: 'id,name,barcode' })
    await legacy.table('preferences').put({ id: 'preferences', value: { targetWeightKg: 65 } }); legacy.close()
    expect((await loadData(database)).settings.targetWeightKg).toBe(65); expect(await database.libraryFoods.count()).toBe(0)
  })
  it('mL和未知营养可保留，丢失旧库引用时收藏快照仍可复用', async () => {
    const drink: FoodEntry = { id: 'drink', name: '自制豆乳', kind: 'manual', weightG: null, nutrientsPer100g: { energyKcal: null, proteinG: null, fatG: null, carbsG: null }, provenance: '用户填写', warnings: [], volumeSnapshot: { amountMl: 250, nutrientsPer100ml: { energyKcal: 60, proteinG: null, fatG: null, carbsG: null } } }
    const saved = await saveLibraryFood(drink, 'manual', database)
    expect(calculateNutrients(entryForFoodChoice(saved.choiceId, null, [], [], [saved])!).energyKcal).toBe(150)
    await toggleFoodFavorite('deleted-food', rice(), database)
    const all = await database.libraryFoods.toArray(); const fallback = entryForFoodChoice('deleted-food', null, [], [], all)!
    expect(fallback.weightG).toBe(150); expect(buildFoodChoices([], undefined, undefined, [], all).some(value => value.id === 'deleted-food')).toBe(true)
  })
})
