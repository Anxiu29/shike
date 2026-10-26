/**
 * 数据装配：USDA/TFDA原始食品 → 近似分组 → 中文展示。来源、原值、稳定ID始终保留。
 * foods是完整库，catalogFoods是新选择用的精简库；配方仍可引用被精简的原始ID。
 * 先分组再翻译，防止译名长度改变代表ID。generated.ts由导入脚本生成，不手改营养值。
 * 许可和复现方式保留在docs/nutrition-data.md、food-localization.md及data/*LICENSE.md。
 */
import type { Nutrients } from './schemas.js';
import { usdaFoods } from './usda-foods.generated.js';
import { surveyFoods } from './fndds-foods.generated.js';
import { chineseFoods } from './chinese-foods.generated.js';
import { curateFoodCatalog } from './food-curation.js';
import { localizeFoodNames } from './food-localization.js';

export const foodCategories = ['主食', '熟食菜肴', '汤羹', '肉类', '水产', '蛋与豆制品', '奶类', '蔬菜', '水果', '坚果种子', '油脂调味', '饮品', '零食'] as const;
export type FoodCategory = (typeof foodCategories)[number];

interface SourceDetails {
  description: string;
  version: string;
  publicationDate: string;
  url: string;
  downloadUrl: string;
}
export type FoodSource = SourceDetails & (
  | { dataset: 'USDA SR Legacy' | 'USDA FNDDS'; fdcId: number; foodCode?: string; sampleCode?: never }
  | { dataset: 'TFDA 食品营养成分'; sampleCode: string; sampleDescription: string; license: 'OGDL-Taiwan-1.0'; fdcId?: never; foodCode?: never }
);
export interface FoodDefinition {
  id: string;
  name: string;
  originalName?: string;
  aliases: string[];
  state: 'raw' | 'cooked' | 'ready' | 'dry';
  category: FoodCategory;
  nutrientsPer100g: Nutrients;
  source: FoodSource;
}
/** 来源编号按各自数据库标示，不能给 TFDA 样本编造 FDC 编号。快照同时保存此文本。 */
export function foodProvenance(food: FoodDefinition): string {
  return `${food.source.dataset} ${food.source.version} · ${food.source.dataset === 'TFDA 食品营养成分' ? `样本 ${food.source.sampleCode}` : `FDC ${food.source.fdcId}`} · ${food.source.description}`;
}
// 构建时从官方数据提取的子集；运行时不依赖营养 API。
const originalFoods: FoodDefinition[] = [...usdaFoods, ...surveyFoods, ...chineseFoods];
export const foods: FoodDefinition[] = localizeFoodNames(originalFoods);
// 新餐搜索与识别使用精简库；原始foods继续供配方、旧ID及来源核验使用。
const curated = curateFoodCatalog(originalFoods);
// 先按原始名称整理，再加译名；翻译长度不能改变已有近似组的代表ID。
export const foodCatalog = { ...curated, foods: localizeFoodNames(curated.foods) };
export const catalogFoods: FoodDefinition[] = foodCatalog.foods;
