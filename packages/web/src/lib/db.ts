/**
 * 持久化入口：Dexie 封装浏览器 IndexedDB；Vue ref/组件草稿不等于数据库记录。
 * 数据库结构版本6与JSON备份版本11独立：前者建表/索引，后者定义可交换文件的业务格式。
 * meals/weights/preferences 保存餐食/称重/设置；estimatedFoods 是同名复用的AI粗估库；
 * water/exercises/dailyPlans 保存饮水/运动/当日预算快照；packagedFoods 保存个人包装标签；
 * libraryFoods 保存显式存库的完整食品快照及收藏。mealPhotos 单独保存餐次压缩照片；不保存模型Key或访问凭证。
 * 写前用Zod验证并转普通JSON，避免Vue Proxy的结构化克隆错误；await事务后才提示成功。
 * 恢复v1～v11备份先统一升级为v11，再在同一事务中替换，失败整体回滚；旧备份缺表补空。
 */
import Dexie, { type Table } from 'dexie'
import { packagedFoodSchema, libraryFoodSchema, foodEntrySchema, mealPhotoDataSchema, type MealPhoto, type LibraryFood, type FoodEntry, type PackagedFood } from '@shike/shared'
import { createId, backupSchema, mealRecordSchema, weightRecordSchema, settingsSchema, estimatedFoodSchema, normalizeFoodName, waterRecordSchema, exerciseRecordSchema, makeDailyPlan, type DailyPlan, type WaterRecord, type ExerciseRecord, type Backup, type MealRecord, type WeightRecord, type Settings, type EstimatedFood } from '@shike/shared'
import { localDate } from './dates'
import { defaultDailyGoals, type PersonalInfo, type DailyGoals } from '@shike/shared'

export type SettingsPatch = Omit<Partial<Settings>, 'personalInfo' | 'dailyGoals'> & {
  personalInfo?: Partial<PersonalInfo> | null
  dailyGoals?: Partial<DailyGoals>
}

interface SettingRow { id: 'preferences'; value: Settings }

export class ShikeDatabase extends Dexie {
  meals!: Table<MealRecord, string>
  weights!: Table<WeightRecord, string>
  preferences!: Table<SettingRow, string>
  estimatedFoods!: Table<EstimatedFood, string>
  water!: Table<WaterRecord, string>
  exercises!: Table<ExerciseRecord, string>
  dailyPlans!: Table<DailyPlan, string>
  packagedFoods!: Table<PackagedFood, string>
  libraryFoods!: Table<LibraryFood, string>
  mealPhotos!: Table<MealPhoto, string>

  constructor(name = 'shike-local-v1') {
    super(name)
    this.version(1).stores({ meals: 'id,date,mealType', weights: 'date', preferences: 'id' })
    // 升级保留版本 1 的饮食与体重；AI 估算只进入这个独立的个人表。
    this.version(2).stores({ meals: 'id,date,mealType', weights: 'date', preferences: 'id', estimatedFoods: 'id,name' })
    this.version(3).stores({ meals: 'id,date,mealType', weights: 'date', preferences: 'id', estimatedFoods: 'id,name', water: 'id,date', exercises: 'id,date', dailyPlans: 'date' })
    this.version(4).stores({ meals: 'id,date,mealType', weights: 'date', preferences: 'id', estimatedFoods: 'id,name', water: 'id,date', exercises: 'id,date', dailyPlans: 'date', packagedFoods: 'id,name,barcode' })
    this.version(5).stores({ libraryFoods: 'id,&choiceId,origin' })
    this.version(6).stores({ mealPhotos: 'id,mealId' })
  }
}

export const db = new ShikeDatabase()
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
/** 模拟来源以条目快照为准，避免导入文件的 mode 误写为 live 而隐藏模拟提示。 */
function normalizeMockMode(record: MealRecord): MealRecord {
  return record.items.some(entry => entry.aiEstimateSnapshot?.provider === 'mock' || entry.packageSnapshot?.provider === 'mock')
    ? { ...record, mode: 'mock' }
    : record
}

export async function loadData(database = db) {
  const [meals, weights, preferences, estimatedFoods, water, exercises, dailyPlans, packagedFoods, libraryFoods] = await Promise.all([
    database.meals.toArray(), database.weights.orderBy('date').toArray(), database.preferences.get('preferences'), database.estimatedFoods.orderBy('name').toArray(),
    database.water.toArray(), database.exercises.toArray(), database.dailyPlans.toArray(), database.packagedFoods.toArray(),
    database.libraryFoods.toArray(),
  ])
  return { meals, weights, estimatedFoods, water, exercises, dailyPlans, packagedFoods, libraryFoods, settings: preferences?.value ?? { targetWeightKg: null } }
}

/** 在记录事务内冻结当日目标。编辑旧记录不会覆盖已经保存的历史预算。 */
async function capturePlan(date: string, database: ShikeDatabase) {
  if (await database.dailyPlans.get(date)) return
  const preferences = await database.preferences.get('preferences')
  await database.dailyPlans.put(makeDailyPlan(date, preferences?.value ?? { targetWeightKg: null }, await database.weights.toArray()))
}

export async function saveMeal(record: MealRecord, database = db, photos?: string[]): Promise<void> {
  const validated = normalizeMockMode(mealRecordSchema.parse(plain(record)))
  const images = photos?.map(photo => mealPhotoDataSchema.parse(photo))
  if (images && images.length > 3) throw new Error('每餐最多保存3张照片。')
  // await 事务完成后 UI 才提示成功，QuotaExceededError 等错误不会产生虚假的保存提示。
  await database.transaction('rw', [database.meals, database.mealPhotos, database.estimatedFoods, database.preferences, database.weights, database.dailyPlans], async () => {
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
    // undefined 表示只改餐食，保留原照片；显式传数组才替换。保存失败时餐食和照片一起回滚。
    if (images !== undefined) {
      await database.mealPhotos.where('mealId').equals(validated.id).delete()
      await database.mealPhotos.bulkPut(images.map((dataUrl, position) => ({ id: createId(), mealId: validated.id, position, dataUrl, createdAt: new Date().toISOString() })))
    }
    await capturePlan(validated.date, database)
  })
}

export async function deleteMeal(id: string, database = db): Promise<void> {
  await database.transaction('rw', [database.meals, database.mealPhotos], async () => {
    await database.mealPhotos.where('mealId').equals(id).delete()
    await database.meals.delete(id)
  })
}

export async function saveWeight(record: WeightRecord, database = db): Promise<void> {
  const validated = weightRecordSchema.parse(plain(record))
  await database.transaction('rw', [database.weights, database.dailyPlans], async () => {
    await database.weights.put(validated)
    for (const date of new Set([validated.date, localDate()])) {
      const plan = await database.dailyPlans.get(date)
      if (plan) await database.dailyPlans.put({ ...makeDailyPlan(date, plan.settingsSnapshot, await database.weights.toArray()), createdAt: plan.createdAt })
    }
  })
}

export async function deleteWeight(date: string, database = db): Promise<void> {
  await database.transaction('rw', [database.weights, database.dailyPlans], async () => {
    await database.weights.delete(date)
    for (const planDate of new Set([date, localDate()])) {
      const plan = await database.dailyPlans.get(planDate)
      if (plan) await database.dailyPlans.put({ ...makeDailyPlan(planDate, plan.settingsSnapshot, await database.weights.toArray()), createdAt: plan.createdAt })
    }
  })
}

export async function saveSettings(value: SettingsPatch, database = db, date = localDate()): Promise<void> {
  // 草稿只交变化字段；事务内读最新preferences再合并，防止跨页保存覆盖其它字段。
  // 首次个人资料仍须完整通过schema；只更新指定日期预算，不批量改写历史。
  await database.transaction('rw', [database.preferences, database.dailyPlans, database.weights], async () => {
    const previous = await database.preferences.get('preferences')
    // 在事务内读取最新设置，只合并本次改过的字段；不让旧表单覆盖其它页面的新目标。
    const patch = plain(value), merged = { targetWeightKg: null, ...previous?.value, ...patch }
    if (patch.personalInfo) merged.personalInfo = { ...previous?.value.personalInfo, ...patch.personalInfo }
    if (patch.dailyGoals) merged.dailyGoals = { ...defaultDailyGoals, ...previous?.value.dailyGoals, ...patch.dailyGoals }
    const validated = settingsSchema.parse(merged)
    await database.preferences.put({ id: 'preferences', value: validated })
    const plan = await database.dailyPlans.get(date)
    await database.dailyPlans.put({ ...makeDailyPlan(date, validated, await database.weights.toArray()), ...(plan ? { createdAt: plan.createdAt } : {}) })
  })
}

export async function saveWater(record: WaterRecord, database = db): Promise<void> {
  const validated = waterRecordSchema.parse(plain(record))
  await database.transaction('rw', [database.water, database.preferences, database.weights, database.dailyPlans], async () => {
    await database.water.put(validated); await capturePlan(validated.date, database)
  })
}
export async function saveExercise(record: ExerciseRecord, database = db): Promise<void> {
  const validated = exerciseRecordSchema.parse(plain(record))
  await database.transaction('rw', [database.exercises, database.preferences, database.weights, database.dailyPlans], async () => {
    if (validated.method === 'manual' && validated.manualScope === 'day') {
      const records = await database.exercises.where('date').equals(validated.date).toArray();
      if (records.some(record => record.id !== validated.id && record.method === 'manual' && record.manualScope === 'day')) throw new Error('当天已有活动累计，请重新打开表单更新该条汇总。');
    }
    await database.exercises.put(validated); await capturePlan(validated.date, database)
  })
}

export async function exportBackup(database = db): Promise<Backup> {
  const data = await database.transaction('r', [database.meals, database.weights, database.preferences, database.estimatedFoods, database.water, database.exercises, database.dailyPlans, database.packagedFoods, database.libraryFoods, database.mealPhotos], async () => ({ ...await loadData(database), mealPhotos: await database.mealPhotos.toArray() }))
  return backupSchema.parse({ schemaVersion: 11, exportedAt: new Date().toISOString(), ...data })
}

export const MAX_BACKUP_BYTES = 100 * 1024 * 1024
export function parseBackup(text: string): Backup {
  if (text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('备份文件不能超过 100 MB。')
  try { return backupSchema.parse(JSON.parse(text)) }
  catch { throw new Error('备份内容无效：请使用食刻导出的版本1～11 JSON 文件，检查数据格式、照片与重复记录。') }
}

export async function restoreBackup(backup: Backup, database = db): Promise<void> {
  const validated = backupSchema.parse(plain(backup))
  // 清空与恢复放在同一事务中；任一步失败都会回滚，保留原来的本地数据。
  await database.transaction('rw', [database.meals, database.weights, database.preferences, database.estimatedFoods, database.water, database.exercises, database.dailyPlans, database.packagedFoods, database.libraryFoods, database.mealPhotos], async () => {
    await database.meals.clear()
    await database.weights.clear()
    await database.preferences.clear()
    await database.estimatedFoods.clear()
    await database.water.clear(); await database.exercises.clear(); await database.dailyPlans.clear()
    await database.packagedFoods.clear()
    await database.libraryFoods.clear()
    await database.mealPhotos.clear()
    // 恢复只归一化模拟标识，不执行 saveMeal，也不会根据餐食生成新的个人估算。
    await database.meals.bulkPut(validated.meals.map(normalizeMockMode))
    await database.weights.bulkPut(validated.weights)
    await database.estimatedFoods.bulkPut(validated.estimatedFoods)
    await database.water.bulkPut(validated.water); await database.exercises.bulkPut(validated.exercises); await database.dailyPlans.bulkPut(validated.dailyPlans)
    await database.packagedFoods.bulkPut(validated.packagedFoods)
    await database.libraryFoods.bulkPut(validated.libraryFoods)
    await database.mealPhotos.bulkPut(validated.mealPhotos)
    await database.preferences.put({ id: 'preferences', value: validated.settings })
  })
}

/** 显式保存包装库；同条码覆盖需要调用者确认，不改写已经保存的餐食快照。 */
export async function savePackagedFood(food: PackagedFood, database = db): Promise<void> {
  const validated = packagedFoodSchema.parse(plain(food))
  await database.transaction('rw', database.packagedFoods, async () => {
    const duplicate = validated.barcode ? await database.packagedFoods.where('barcode').equals(validated.barcode).first() : undefined
    if (duplicate && duplicate.id !== validated.id) throw new Error('此条码已在包装库中，请确认覆盖后再保存。')
    await database.packagedFoods.put(validated)
  })
}

/**
 * 明确点“存入食品库”才保存，与saveMeal自动维护的estimatedFoods是不同功能。
 * 指纹忽略条目ID，其余完整快照相同才去重；同名不同配方/档位/份量允许并存。
 * libraryFoodSchema拒绝模拟来源；快照保留营养、来源、配方、区间、包装和g/mL份量。
 * 再次添加由food-picker.entryForFoodChoice深拷贝并生成新ID，不改库中条目或旧餐食。
 * 回归：web/tests/food-library.test.ts、tests/e2e/food-library.spec.ts。
 */
export async function saveLibraryFood(entry: FoodEntry, origin: 'ai' | 'manual', database = db): Promise<LibraryFood> {
  return (await saveLibraryFoods([{ entry, origin }], database))[0]!
}

/** 一次存入多项时整批提交；其中任何快照无效都会回滚，不留下半份常用库。 */
export async function saveLibraryFoods(entries: Array<{ entry: FoodEntry; origin: 'ai' | 'manual' }>, database = db): Promise<LibraryFood[]> {
  const snapshots = entries.map(({ entry, origin }) => ({ entry: foodEntrySchema.parse(plain(entry)), origin }))
  const fingerprint = (value: FoodEntry) => JSON.stringify({ ...value, id: '' })
  return database.transaction('rw', database.libraryFoods, async () => {
    const known = await database.libraryFoods.toArray(), saved: LibraryFood[] = []
    for (const snapshot of snapshots) {
      const existing = known.find(food => food.origin !== 'library' && fingerprint(food.entry) === fingerprint(snapshot.entry))
      if (existing) { saved.push(existing); continue }
      const now = new Date().toISOString(), id = createId()
      const food = libraryFoodSchema.parse({ id, choiceId: `saved:${id}`, origin: snapshot.origin, entry: snapshot.entry, favorite: false, createdAt: now, updatedAt: now })
      await database.libraryFoods.add(food)
      known.push(food); saved.push(food)
    }
    return saved
  })
}

/** 收藏按稳定选择ID切换；普通库取消收藏时删除副本，个人存库食品仍保留。 */
export async function toggleFoodFavorite(choiceId: string, entry: FoodEntry, database = db): Promise<boolean> {
  return database.transaction('rw', database.libraryFoods, async () => {
    const previous = await database.libraryFoods.where('choiceId').equals(choiceId).first()
    if (previous) {
      if (previous.origin === 'library' && previous.favorite) await database.libraryFoods.delete(previous.id)
      else await database.libraryFoods.put({ ...previous, favorite: !previous.favorite, updatedAt: new Date().toISOString() })
      return !previous.favorite
    }
    if (choiceId.startsWith('saved:') || choiceId === 'ai-current') throw new Error('请先将这项食物存入食品库。')
    const now = new Date().toISOString()
    await database.libraryFoods.add(libraryFoodSchema.parse({ id: createId(), choiceId, entry: plain(entry), favorite: true, origin: 'library', createdAt: now, updatedAt: now }))
    return true
  })
}
