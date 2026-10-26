import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseOffProduct, packagedEntry, syncPackageEntry, calculateNutrients, type MealRecord } from '@shike/shared'
import { ShikeDatabase, savePackagedFood, saveMeal, exportBackup, parseBackup, restoreBackup } from '../src/lib/db'
let database: ShikeDatabase
const code = '3274080005003'
const food = () => parseOffProduct({ status: 1, product: { code, product_name: '测试饮料', quantity: '250 ml', nutriments: { 'energy-kcal_100g': 40 } } }, code)!
beforeEach(() => { database = new ShikeDatabase(`library-${crypto.randomUUID()}`) })
afterEach(async () => { await database.delete() })
describe('包装库与历史快照', () => {
  it('覆盖必须复用ID；以后修改、删除库条目不影响已保存餐食', async () => {
    const original = food(); await savePackagedFood(original, database)
    const entry = packagedEntry(original); entry.packageSnapshot!.consumedUnit = 'package'; entry.packageSnapshot!.consumedAmount = 0.5; syncPackageEntry(entry)
    const now = new Date().toISOString()
    const meal: MealRecord = { id: 'meal', date: '2026-10-16', mealType: 'snack', mode: 'manual', createdAt: now, updatedAt: now, items: [entry] }
    await saveMeal(meal, database)
    await expect(savePackagedFood({ ...original, id: 'duplicate' }, database)).rejects.toThrow('确认覆盖')
    await savePackagedFood({ ...original, label: { ...original.label, energy: { value: 1, unit: 'kcal' } } }, database)
    await database.packagedFoods.delete(original.id)
    expect(calculateNutrients((await database.meals.get('meal'))!.items[0]!).energyKcal).toBe(50)
  })
  it('v8备份带来源、旧版本升级为空库，恢复失败时包装库一起回滚', async () => {
    await savePackagedFood(food(), database)
    const backup = parseBackup(JSON.stringify(await exportBackup(database))); expect(backup.schemaVersion).toBe(10); expect(backup.packagedFoods[0]!.source!.license).toBe('ODbL-1.0')
    const { libraryFoods: _library, packagedFoods: _, ...legacy } = backup; const old = parseBackup(JSON.stringify({ ...legacy, schemaVersion: 4 })); expect(old.packagedFoods).toEqual([])
    await database.packagedFoods.clear(); await restoreBackup(backup, database); expect(await database.packagedFoods.count()).toBe(1)
    database.packagedFoods.hook('creating', () => { throw new Error('storage-full') })
    await expect(restoreBackup({ ...backup, packagedFoods: [{ ...food(), id: 'another' }] }, database)).rejects.toThrow('storage-full')
    expect((await database.packagedFoods.toArray())[0]!.id).toBe(food().id)
  })
  it('旧IndexedDB v3升级只加新表，保留原有记录', async () => {
    const name = database.name; await database.delete()
    const old = new Dexie(name); old.version(3).stores({ meals: 'id,date,mealType', weights: 'date', preferences: 'id', estimatedFoods: 'id,name', water: 'id,date', exercises: 'id,date', dailyPlans: 'date' })
    await old.table('weights').put({ date: '2026-10-16', weightKg: 70, updatedAt: new Date().toISOString() }); old.close()
    database = new ShikeDatabase(name); expect((await database.weights.toArray())[0]!.weightKg).toBe(70); expect(await database.packagedFoods.count()).toBe(0)
  })
})
