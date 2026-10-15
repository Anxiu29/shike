import { createId, findFood, findRecipe, findEstimatedFood, normalizeFoodName, selectedEstimateOption, rangesToMidpoints, applyEstimateLevel, calculateEnergyRange, calculateNutrients, createEstimatedFoodEntry, createFoodEntry, createRecipeEntry, emptyNutrients, nutrientKeys, type FoodEntry, type EstimatedFood, type Nutrients, type NutritionEstimateProfile } from '@shike/shared'

export function manualEntry(name = '', weightG: number | null = null): FoodEntry {
  return { id: createId(), name, weightG, nutrientsPer100g: emptyNutrients(), provenance: '未匹配营养数据，请选择基础食物、参考配方或手动补充。', kind: 'unknown', warnings: [] }
}

export function matchedEntry(name: string, weightG: number | null, personalFoods: EstimatedFood[] = [], currentEstimate?: EstimatedFood): FoodEntry {
  // 可靠来源先匹配：已有数据库和参考配方不能被模型粗估静默替换。
  const recipe = findRecipe(name)
  if (recipe) {
    // 菜名确定但照片无法估重时也能匹配配方；整份营养仍待补重量，不套默认份量。
    const entry = createRecipeEntry(recipe, weightG !== null && weightG > 0 ? weightG : recipe.referenceWeightG)
    entry.weightG = weightG
    return entry
  }
  const food = findFood(name)
  if (food) return createFoodEntry(food, weightG)
  const personal = findEstimatedFood(name, personalFoods.filter(item => item.provider !== 'mock' && Object.values(item.nutrientsPer100g).some(value => value !== null)))
  const currentHasEnergyRange = currentEstimate?.estimateProfile
    ? selectedEstimateOption(currentEstimate.estimateProfile, 'medium').rangesPer100g.energyKcal !== null
    : false
  const personalHasEnergyRange = personal?.estimateProfile
    ? selectedEstimateOption(personal.estimateProfile, 'medium').rangesPer100g.energyKcal !== null
    : false
  // 旧个人单值不能挡住新模型提供的有效三档；只在确认保存后升级原有库条目。
  if (personal && currentEstimate && currentHasEnergyRange && !personalHasEnergyRange) return createEstimatedFoodEntry(currentEstimate, weightG)
  // 新的一餐总是从中档开始；上次少糖／少油不能自动套用到下一份。
  if (personal) {
    const entry = createEstimatedFoodEntry({ ...personal, provenance: `个人估算库 · ${personal.provenance}` }, weightG)
    return personal.estimateProfile ? applyEstimateLevel(entry, 'medium') : entry
  }
  return currentEstimate ? createEstimatedFoodEntry(currentEstimate, weightG) : manualEntry(name, weightG)
}

export function recognitionEstimate(name: string, nutrientsPer100g: Nutrients | null, assumptions: string[], provider: EstimatedFood['provider'], model: string, profile?: NutritionEstimateProfile | null): EstimatedFood | undefined {
  if (profile) {
    const option = selectedEstimateOption(profile, 'medium')
    nutrientsPer100g = rangesToMidpoints(option.rangesPer100g)
    assumptions = option.assumptions
  }
  if (!nutrientsPer100g || !nutrientKeys.some(key => nutrientsPer100g[key] !== null)) return undefined
  const now = new Date().toISOString()
  return { id: createId(), name, nutrientsPer100g: { ...nutrientsPer100g }, ...(profile ? { estimateProfile: JSON.parse(JSON.stringify(profile)), estimateLevel: 'medium' as const } : {}), provenance: `${provider === 'mock' ? '模拟' : 'AI'} 粗估 · ${provider} / ${model}；非实测营养数据。`, assumptions: [...assumptions], provider, model, createdAt: now, updatedAt: now }
}

export function entryBasis(entry: FoodEntry): string {
  if (entry.kind === 'ai') return entry.provenance.startsWith('个人估算库') ? '个人估算库 · AI 粗估' : entry.aiEstimateSnapshot?.provider === 'mock' ? '模拟 AI 估算' : 'AI 估算'
  return entry.kind === 'recipe' ? '参考配方估算' : entry.kind === 'database' ? entry.provenance.startsWith('USDA FNDDS') ? 'USDA 膳食参考' : 'USDA 基础食物' : entry.kind === 'manual' ? '手动营养数据' : '暂无法估算'
}

/** 名称纠正代表另一种食物时，旧模型的数值不能冒充新食物的估算。 */
export function rematchRenamedEntry(entry: FoodEntry, previousName: string, personalFoods: EstimatedFood[]): { entry: FoodEntry; changed: boolean } {
  if (normalizeFoodName(entry.name) === normalizeFoodName(previousName)) return { entry, changed: false }
  // 手动营养值由用户填写，允许用改名修正标签，不替用户改写这些数值。
  if (entry.kind === 'manual') return { entry, changed: true }
  const next = matchedEntry(entry.name, entry.weightG, personalFoods)
  next.id = entry.id
  return { entry: next, changed: true }
}

/** 单值视作退化区间；缺失保持缺失，仅把可计算部分相加。 */
export function aggregateEnergyRanges(entries: FoodEntry[]): { min: number; max: number; missing: number; hasProfile: boolean } {
  return entries.reduce<{ min: number; max: number; missing: number; hasProfile: boolean }>((total, entry) => {
    const energy = calculateNutrients(entry).energyKcal
    const range = calculateEnergyRange(entry) ?? (energy === null ? null : { min: energy, max: energy })
    if (range) { total.min += range.min; total.max += range.max }
    else total.missing++
    if (entry.estimateProfile) total.hasProfile = true
    return total
  }, { min: 0, max: 0, missing: 0, hasProfile: false })
}

/** 确定输入撤销情景假设，避免手动改油后仍显示旧的“多油”提醒。 */
export function discardEstimateContext(entry: FoodEntry, discardAiSnapshot = false): void {
  const assumptions = new Set([
    ...(entry.estimateProfile?.options.flatMap(option => option.assumptions) ?? []),
    ...(discardAiSnapshot ? entry.aiEstimateSnapshot?.assumptions ?? [] : []),
  ])
  entry.warnings = entry.warnings.filter(warning => !assumptions.has(warning) && !(discardAiSnapshot && warning.startsWith('AI 粗估，不是实测数据')))
  delete entry.estimateProfile; delete entry.estimateLevel
  if (discardAiSnapshot) delete entry.aiEstimateSnapshot
}

/** 配方只累计配料一次。成品重量作分母，油量可以独立修改而不猜测含水变化。 */
export function recalculateRecipe(entry: FoodEntry, preserveProfile = false): void {
  // 手动配料代表用户自己的具体配比；只在整体缩放时保留每 100 g 的估算档位。
  if (!preserveProfile) discardEstimateContext(entry)
  if (!entry.recipeSnapshot || !entry.weightG || entry.weightG <= 0) return
  const ingredients = entry.recipeSnapshot.ingredients
  for (const key of nutrientKeys) {
    entry.nutrientsPer100g[key] = ingredients.some(item => item.weightG > 0 && item.nutrientsPer100g[key] === null) ? null
      : ingredients.reduce((sum, item) => sum + (item.nutrientsPer100g[key] ?? 0) * item.weightG / 100, 0) / entry.weightG * 100
  }
  entry.recipeSnapshot.referenceWeightG = entry.weightG
}

export function resizeEntry(entry: FoodEntry, value: number | null): void {
  // 用户常先清空输入再填新重量：使用配方快照基准，避免 null 丢失缩放比例。
  const previous = entry.recipeSnapshot?.referenceWeightG ?? entry.weightG
  entry.weightG = value
  if (entry.recipeSnapshot && previous && value && value > 0) {
    for (const ingredient of entry.recipeSnapshot.ingredients) ingredient.weightG *= value / previous
    recalculateRecipe(entry, true)
  }
}

export function inputNumber(event: Event): number | null {
  const input = event.target as HTMLInputElement
  // 只约束用户输入；配方缩放和营养中值继续保留完整计算精度。
  return input.value === '' ? null : Math.round((Number(input.value) + Number.EPSILON) * 100) / 100
}
