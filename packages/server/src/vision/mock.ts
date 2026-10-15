import type { RecognitionResult } from '@shike/shared';
import type { VisionService } from './types.js';

export class MockVisionService implements VisionService {
  readonly mode = 'mock' as const;
  readonly provider = 'mock' as const;
  readonly model = 'mock-demo-v1';
  async recognize(): Promise<RecognitionResult> {
    // 固定演示数据，刻意不声称照片被分析。前端和记录必须持续保留 mock 标识。
    return {
      isFood: true,
      foods: [
        { name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: ['模拟米饭，与上传照片无关；请手动修改。'],
          estimatedNutrientsPer100g: { energyKcal: 130, proteinG: 3, fatG: 0.3, carbsG: 28 },
          nutritionAssumptions: ['模拟每 100 g 粗估，假设清水煮白米饭，无额外油；真实使用优先匹配 USDA 数据。'], nutritionEstimateProfile: null },
        { name: '杂粮粥', estimatedWeightG: 200, visibleIngredients: [], uncertainties: ['模拟粥，与上传照片无关；稀稠与谷物配比需核对。'],
          estimatedNutrientsPer100g: { energyKcal: 75, proteinG: 1.8, fatG: 0.8, carbsG: 16 },
          nutritionAssumptions: ['模拟普通甜度稀粥情景，谷物配比、糖量和含水量未经测量；不是营养标准。'],
          nutritionEstimateProfile: { factor: 'sweetness', options: [
            { level: 'low', label: '无糖比较稀', rangesPer100g: { energyKcal: { min: 40, max: 60 }, proteinG: { min: 1, max: 1.8 }, fatG: { min: 0.3, max: 0.7 }, carbsG: { min: 8, max: 12 } }, assumptions: ['模拟无糖、比较稀的清水杂粮粥，谷物比例和含水量未知。'] },
            { level: 'medium', label: '普通甜度', rangesPer100g: { energyKcal: { min: 60, max: 90 }, proteinG: { min: 1.2, max: 2.4 }, fatG: { min: 0.4, max: 1.2 }, carbsG: { min: 12, max: 20 } }, assumptions: ['模拟普通甜度稀粥情景，谷物配比、糖量和含水量未经测量；不是营养标准。'] },
            { level: 'high', label: '糖多浓稠', rangesPer100g: { energyKcal: { min: 90, max: 120 }, proteinG: { min: 1.8, max: 3 }, fatG: { min: 0.6, max: 1.6 }, carbsG: { min: 20, max: 26 } }, assumptions: ['模拟糖较多或更浓稠的杂粮粥情景，实际糖量未经测量。'] },
          ] } },
        { name: '西兰花', estimatedWeightG: 80, visibleIngredients: [], uncertainties: ['模拟蔬菜，与上传照片无关；请手动修改。'],
          estimatedNutrientsPer100g: { energyKcal: 35, proteinG: 2.4, fatG: 0.4, carbsG: 7 },
          nutritionAssumptions: ['模拟每 100 g 粗估，假设无额外油的水煮西兰花；实际炒菜需修改用油。'], nutritionEstimateProfile: null },
      ], uncertainties: ['当前为模拟模式，这些名称和重量不是对照片的真实识别结果。'],
    };
  }
}
