/**
 * 编辑和展示已有条目的快照工具。这里不做整库查找，避免首页为展示来源或热量加载食品库。
 * 名称匹配、新建未知条目在entry-matching.ts；底部重导出保留原调用接口。
 */
import { createId, selectedEstimateOption, rangesToMidpoints, applyEstimateLevel, calculateEnergyRange, calculateNutrients, emptyNutrients, nutrientKeys, type FoodEntry, type EstimatedFood, type Nutrients, type NutritionEstimateProfile } from "@shike/shared";

/** 只构造本次待核对的模型候选；本函数不写个人库，是否持久化由确认保存的数据库事务决定。 */
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
  if (entry.volumeSnapshot) return '饮品营养 · 每100 mL'
  if (entry.packageSnapshot?.source) return entry.packageSnapshot.manuallyEdited ? 'Open Food Facts · 已手动修正' : 'Open Food Facts · 包装参考'
  if (entry.kind === 'label') return entry.packageSnapshot?.provider === 'mock' ? '模拟包装标签' : entry.packageSnapshot?.manuallyEdited ? '包装标签 · 已手动修改' : entry.packageSnapshot?.provider === 'offline' ? '包装标签 · 本机识读（试验）' : '包装标签 · AI 读取'
  if (entry.kind === 'ai') return entry.provenance.startsWith('个人估算库') ? '个人估算库 · AI 粗估' : entry.aiEstimateSnapshot?.provider === 'mock' ? '模拟 AI 估算' : 'AI 估算'
  return entry.kind === 'recipe' ? '参考配方估算' : entry.kind === 'database' ? entry.provenance.startsWith('USDA FNDDS') ? 'USDA 膳食参考' : 'USDA 基础食物' : entry.kind === 'manual' ? '手动营养数据' : '暂无法估算'
}

/** 单值视作上下界相同的区间；只累计已知项，同时返回缺失数供页面显示“已知部分”。 */
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
  // 直接改克数表示回到重量计量；数量计量调用者会在换算后附回完整快照。
  delete entry.portionSnapshot
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

// 旧调用点保留相同入口；展示层只导入快照函数时不会引入查库工厂。
export { manualEntry, matchedEntry, rematchRenamedEntry } from "./entry-matching";
