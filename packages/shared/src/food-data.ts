import type { Nutrients } from './schemas.js';
import { usdaFoods } from './usda-foods.generated.js';
import { surveyFoods } from './fndds-foods.generated.js';

export const foodCategories = ['主食', '熟食菜肴', '汤羹', '肉类', '水产', '蛋与豆制品', '奶类', '蔬菜', '水果', '坚果种子', '油脂调味', '饮品', '零食'] as const;
export type FoodCategory = (typeof foodCategories)[number];

export interface FoodDefinition {
  id: string;
  name: string;
  aliases: string[];
  state: 'raw' | 'cooked' | 'ready' | 'dry';
  category: FoodCategory;
  nutrientsPer100g: Nutrients;
  source: {
    fdcId: number;
    description: string;
    dataset: 'USDA SR Legacy' | 'USDA FNDDS';
    version: string;
    publicationDate: string;
    url: string;
    downloadUrl: string;
    foodCode?: string;
  };
}
// 构建时从官方数据提取的子集；运行时不依赖 USDA API。
export const foods: FoodDefinition[] = [...usdaFoods, ...surveyFoods];
