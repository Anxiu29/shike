import type { NutritionEstimateProfile } from '@shike/shared'

export const porridgeProfile: NutritionEstimateProfile = {
  factor: 'sweetness',
  options: [
    { level: 'low', label: '无糖较稀', rangesPer100g: { energyKcal: { min: 40, max: 60 }, proteinG: { min: 0.8, max: 1.2 }, fatG: { min: 0.2, max: 0.4 }, carbsG: { min: 8, max: 12 } }, assumptions: ['无额外糖，较稀的粥。'] },
    { level: 'medium', label: '普通甜度', rangesPer100g: { energyKcal: { min: 60, max: 90 }, proteinG: { min: 1, max: 2 }, fatG: { min: 0.4, max: 0.8 }, carbsG: { min: 12, max: 18 } }, assumptions: ['普通甜度与含水量，配比仍不确定。'] },
    { level: 'high', label: '糖多浓稠', rangesPer100g: { energyKcal: { min: 90, max: 120 }, proteinG: { min: 2, max: 3 }, fatG: { min: 0.6, max: 1.2 }, carbsG: { min: 18, max: 25 } }, assumptions: ['糖多且较浓稠，实际糖量未知。'] },
  ],
}
