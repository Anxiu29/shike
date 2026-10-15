import Dexie, { type Table } from 'dexie'
import { createId, backupSchema, mealRecordSchema, weightRecordSchema, settingsSchema, estimatedFoodSchema, normalizeFoodName, type Backup, type MealRecord, type WeightRecord, type Settings, type EstimatedFood } from '@shike/shared'

interface SettingRow { id: 'preferences'; value: Settings }

export class ShikeDatabase extends Dexie {
  meals!: Table<MealRecord, string>
  weights!: Table<WeightRecord, string>
  preferences!: Table<SettingRow, string>
  estimatedFoods!: Table<EstimatedFood, string>

  constructor(name = 'shike-local-v1') {
    super(name)
    this.version(1).stores({ meals: 'id,date,mealType', weights: 'date', preferences: 'id' })
    // 升级保留版本 1 的饮食与体重；AI 估算只进入这个独立的个人表。
    this.version(2).stores({ meals: 'id,date,mealType', weights: 'date', preferences: 'id', estimatedFoods: 'id,name' })
  }
}

export const db = new ShikeDatabase()
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
/** 模拟来源以条目快照为准，避免导入文件的 mode 误写为 live 而隐藏模拟提示。 */
function normalizeMockMode(record: MealRecord): MealRecord {
  return record.items.some(entry => entry.aiEstimateSnapshot?.provider === 'mock')
    ? { ...record, mode: 'mock' }
    : record
}

export async function loadData(database = db) {
  const [meals, weights, preferences, estimatedFoods] = await Promise.all([
    database.meals.toArray(), database.weights.orderBy('date').toArray(), database.preferences.get('preferences'), database.estimatedFoods.orderBy('name').toArray(),
  ])
  return { meals, weights, estimatedFoods, settings: preferences?.value ?? { targetWeightKg: null } }
}

export async function saveMeal(record: MealRecord, database = db): Promise<void> {
  const validated = normalizeMockMode(mealRecordSchema.parse(plain(record)))
  // await 事务完成后 UI 才提示成功，QuotaExceededError 等错误不会产生虚假的保存提示。
  await database.transaction('rw', database.meals, database.estimatedFoods, async () => {
    const knownEstimates = await database.estimatedFoods.toArray()
    for (const entry of validated.items) {
      // 模拟结果可练习保存，但绝不能成为未来真实识别的估算依据。
      if (validated.mode !== 'live' || entry.kind !== 'ai' || !entry.aiEstimateSnapshot || entry.aiEstimateSnapshot.provider === 'mock' || !Object.values(entry.nutrientsPer100g).some(value => value !== null)) continue
      const existing = knownEstimates.find(food => normalizeFoodName(food.name) === normalizeFoodName(entry.name))
      const now = new Date().toISOString()
      const estimate = estimatedFoodSchema.parse({
        id: existing?.id ?? createId(), name: entry.name,
        nutrientsPer100g: entry.nutrientsPer100g,
        provenance: `AI 粗估 · ${entry.aiEstimateSnapshot.provider} / ${entry.aiEstimateSnapshot.model}；非实测营养数据。`,
        assumptions: entry.aiEstimateSnapshot.assumptions,
        ...(entry.estimateProfile ? { estimateProfile: entry.estimateProfile, estimateLevel: entry.estimateLevel ?? 'medium' } : {}),
        provider: entry.aiEstimateSnapshot.provider, model: entry.aiEstimateSnapshot.model,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      })
      await database.estimatedFoods.put(estimate)
      entry.referenceId = estimate.id
      if (existing) Object.assign(existing, estimate)
      else knownEstimates.push(estimate)
    }
    // 估算库与餐食要同时成功；失败时两张表一起回滚，未确认的草稿从不写库。
    await database.meals.put(validated)
  })
}

export async function saveWeight(record: WeightRecord, database = db): Promise<void> {
  const validated = weightRecordSchema.parse(plain(record))
  await database.transaction('rw', database.weights, () => database.weights.put(validated).then(() => undefined))
}

export async function saveSettings(value: Settings, database = db): Promise<void> {
  await database.preferences.put({ id: 'preferences', value: settingsSchema.parse(plain(value)) })
}

export async function exportBackup(database = db): Promise<Backup> {
  const data = await database.transaction('r', database.meals, database.weights, database.preferences, database.estimatedFoods, () => loadData(database))
  return backupSchema.parse({ schemaVersion: 2, exportedAt: new Date().toISOString(), ...data })
}

export function parseBackup(text: string): Backup {
  if (text.length > 20 * 1024 * 1024) throw new Error('备份文件不能超过 20 MB。')
  try { return backupSchema.parse(JSON.parse(text)) }
  catch { throw new Error('备份内容无效：请使用食刻导出的版本 1 或 2 JSON 文件，检查数据格式与重复记录。') }
}

export async function restoreBackup(backup: Backup, database = db): Promise<void> {
  const validated = backupSchema.parse(plain(backup))
  // 清空与恢复放在同一事务中；任一步失败都会回滚，保留原来的本地数据。
  await database.transaction('rw', database.meals, database.weights, database.preferences, database.estimatedFoods, async () => {
    await database.meals.clear()
    await database.weights.clear()
    await database.preferences.clear()
    await database.estimatedFoods.clear()
    // 恢复只归一化模拟标识，不执行 saveMeal，也不会根据餐食生成新的个人估算。
    await database.meals.bulkPut(validated.meals.map(normalizeMockMode))
    await database.weights.bulkPut(validated.weights)
    await database.estimatedFoods.bulkPut(validated.estimatedFoods)
    await database.preferences.put({ id: 'preferences', value: validated.settings })
  })
}
