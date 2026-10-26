import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupSchema, createFoodEntry, findFood, mealPhotoDataSchema, type MealRecord } from '@shike/shared'
import { ShikeDatabase, saveMeal, deleteMeal, exportBackup, parseBackup, restoreBackup } from '../src/lib/db'
const photo = 'data:image/jpeg;base64,/9j/2Q=='
const second = 'data:image/jpeg;base64,/9j/4AAQ'
const now = '2026-10-26T02:00:00.000Z'
const meal = (): MealRecord => ({ id: 'photo-meal', date: '2026-10-26', mealType: 'lunch', mode: 'live', items: [createFoodEntry(findFood('米饭')!, 150)], createdAt: now, updatedAt: now })
let database: ShikeDatabase
beforeEach(() => { database = new ShikeDatabase(`meal-photos-${crypto.randomUUID()}`) })
afterEach(async () => { await database.delete() })
describe('餐次照片持久化', () => {
  it('照片单独保存；编辑保持照片，显式替换或移除才更改图片', async () => {
    await saveMeal(meal(), database, [photo])
    const original = await database.mealPhotos.toArray()
    expect(original).toHaveLength(1)
    const edited = meal(); edited.items[0]!.weightG = 200
    await saveMeal(edited, database)
    expect(await database.mealPhotos.toArray()).toEqual(original)
    await saveMeal(edited, database, [second])
    expect((await database.mealPhotos.toArray())[0]!.dataUrl).toBe(second)
    await saveMeal(edited, database, [])
    expect(await database.mealPhotos.count()).toBe(0)
    expect((await database.meals.get(edited.id))!.items[0]!.weightG).toBe(200)
  })
  it('后续写入失败，餐次和原照片一起回滚，不产生半条记录', async () => {
    await saveMeal(meal(), database, [photo])
    const fail = () => { throw new Error('模拟磁盘写入失败') }
    database.dailyPlans.hook('creating', fail)
    await expect(saveMeal({ ...meal(), date: '2026-10-25' }, database, [second])).rejects.toThrow()
    database.dailyPlans.hook('creating').unsubscribe(fail)
    expect((await database.meals.get(meal().id))!.date).toBe('2026-10-26')
    expect((await database.mealPhotos.toArray())[0]!.dataUrl).toBe(photo)
    expect(await database.dailyPlans.get('2026-10-25')).toBeUndefined()
  })
  it('删除照片与记录同一事务，失败不丢照片，成功无孤立图片', async () => {
    await saveMeal(meal(), database, [photo, second])
    const fail = () => { throw new Error('模拟删除失败') }
    database.meals.hook('deleting', fail)
    await expect(deleteMeal(meal().id, database)).rejects.toThrow()
    database.meals.hook('deleting').unsubscribe(fail)
    expect(await database.mealPhotos.count()).toBe(2)
    await deleteMeal(meal().id, database)
    expect(await database.mealPhotos.count()).toBe(0)
    expect(await database.meals.count()).toBe(0)
  })
  it('v11备份保留照片；v10仍可恢复并明确按旧格式清空照片', async () => {
    await saveMeal(meal(), database, [photo, second])
    const backup = parseBackup(JSON.stringify(await exportBackup(database)))
    expect(backup.schemaVersion).toBe(11)
    expect([...backup.mealPhotos].sort((a, b) => a.position - b.position).map(item => item.dataUrl)).toEqual([photo, second])
    await deleteMeal(meal().id, database); await restoreBackup(backup, database)
    expect(await database.mealPhotos.toArray()).toEqual(backup.mealPhotos)
    const { mealPhotos: _photos, ...legacy } = backup
    const old = parseBackup(JSON.stringify({ ...legacy, schemaVersion: 10 }))
    await restoreBackup(old, database)
    expect(await database.meals.count()).toBe(1)
    expect(await database.mealPhotos.count()).toBe(0)
  })
  it('拒绝远程、SVG、过大、重复、孤立或单餐超过3张的图片', async () => {
    for (const invalid of ['https://example.com/photo.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,/9j/' + 'A'.repeat(1_398_100)]) expect(mealPhotoDataSchema.safeParse(invalid).success).toBe(false)
    await expect(saveMeal(meal(), database, [photo, photo, photo, photo])).rejects.toThrow('最多保存3张')
    await saveMeal(meal(), database, [photo])
    const backup = await exportBackup(database), image = backup.mealPhotos[0]!
    expect(backupSchema.safeParse({ ...backup, mealPhotos: [image, image] }).success).toBe(false)
    expect(backupSchema.safeParse({ ...backup, mealPhotos: [{ ...image, mealId: 'missing' }] }).success).toBe(false)
    expect(backupSchema.safeParse({ ...backup, mealPhotos: Array.from({ length: 4 }, (_, i) => ({ ...image, id: `photo-${i}` })) }).success).toBe(false)
  })
  it('v5数据库原地升级，保留已有餐次和收藏，不伪造历史照片', async () => {
    const legacy = new Dexie(database.name)
    legacy.version(5).stores({ meals: 'id,date,mealType', weights: 'date', preferences: 'id', estimatedFoods: 'id,name', water: 'id,date', exercises: 'id,date', dailyPlans: 'date', packagedFoods: 'id,name,barcode', libraryFoods: 'id,&choiceId,origin' })
    await legacy.table('meals').put(meal()); legacy.close()
    expect(await database.meals.count()).toBe(1)
    expect(await database.mealPhotos.count()).toBe(0)
    await saveMeal({ ...meal(), id: 'new-meal' }, database, [photo])
    expect(await database.meals.count()).toBe(2)
  })
})
