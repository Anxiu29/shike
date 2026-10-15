import { createEstimatedFoodEntry, findEstimatedFood, findFood, findRecipe, type EstimatedFood, type FoodEntry, type RecognitionResponse } from '@shike/shared'
import { matchedEntry, recognitionEstimate } from './entries'
import type { FoodMatchContext } from './food-picker'

export interface RecognizedFoodDraft {
  entry: FoodEntry
  candidate?: FoodEntry
  context: FoodMatchContext
  estimatedWeightG: number | null
  warnings: string[]
}

/** 仅去掉数量／容器描述；保留糖、油、生熟和做法，不能将相似菜静默当成同一道菜。 */
export function recognitionMatchName(name: string, personalFoods: EstimatedFood[] = []): string {
  const knownName = (value: string) => findRecipe(value) || findFood(value) || findEstimatedFood(value, personalFoods.filter(food => food.provider !== 'mock' && Object.values(food.nutrientsPer100g).some(nutrient => nutrient !== null)))
  const original = name.trim()
  if (knownName(original)) return original
  const withoutPortion = original.replace(/^(?:(?:约)?(?:[一二两三四五六七八九十半]|\d+(?:\.\d+)?)(?:小|大|中)?(?:碗|份|盘|杯|块|片|个|只|根))[\s、，:：]*/, '').trim()
  return knownName(withoutPortion) ? withoutPortion : original
}

/** 一个视觉条目对应一条记录，重量按同一条目传递，不平均分餐盘总重，也不展开可见配料。 */
export function prepareRecognition(response: RecognitionResponse, personalFoods: EstimatedFood[] = []): RecognizedFoodDraft[] {
  return response.result.foods.map(food => {
    const estimate = recognitionEstimate(food.name, food.estimatedNutrientsPer100g, food.nutritionAssumptions, response.provider, response.model, food.nutritionEstimateProfile)
    const entry = matchedEntry(recognitionMatchName(food.name, personalFoods), food.estimatedWeightG, personalFoods, estimate)
    // 已匹配条目用食物库的规范名称；原始视觉名称留在 context，供用户核对。
    const candidate = estimate ? createEstimatedFoodEntry(estimate, food.estimatedWeightG) : undefined
    if (candidate) candidate.id = entry.id
    const visibleNote = food.visibleIngredients.length ? [`可见成分：${food.visibleIngredients.join('、')}。隐藏用油与调料仍需确认。`.slice(0, 500)] : []
    const warnings = [...food.uncertainties, ...visibleNote].slice(0, 30)
    entry.warnings = [...new Set([...entry.warnings, ...warnings])].slice(0, 30)
    return { entry, candidate, warnings, context: { name: food.name, visibleIngredients: [...food.visibleIngredients] }, estimatedWeightG: food.estimatedWeightG }
  })
}
