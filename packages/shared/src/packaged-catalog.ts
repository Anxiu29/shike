import type { PackagedFood } from './schemas.js';
import { publicPackagedFoods } from './packaged-catalog.generated.js';

export const packagedCategories = ['奶与植物奶', '饮料', '方便食品', '零食与坚果', '谷物与蛋白粉', '面包与糕点', '肉蛋与即食', '冷冻与罐头', '调味品', '其他包装', '我的包装'] as const;
export type PackagedCategory = typeof packagedCategories[number];
export interface PublicPackagedFood { food: PackagedFood; category: PackagedCategory; aliases: string[]; originalName?: string; nameTranslation?: 'source' | 'translated' | 'existing' | 'category' | 'untranslated' }
/** OFF公开数据快照，保留ODbL来源；不自动写入个人库，也不推定整包已吃完。 */
export const builtinPackagedFoods: readonly PublicPackagedFood[] = publicPackagedFoods;

/** 个人核对标签优先，同一条码只显示一次；不同条码的相近商品不能按热量合并。 */
export function packagedCatalogItems(personal: readonly PackagedFood[] = []): PublicPackagedFood[] {
  const barcodes = new Set(personal.map(food => food.barcode).filter(Boolean));
  const ids = new Set(personal.map(food => food.id));
  return [
    ...personal.map(food => ({ food, category: builtinPackagedFoods.find(item => item.food.barcode === food.barcode)?.category ?? '我的包装' as PackagedCategory, aliases: [] })),
    ...builtinPackagedFoods.filter(item => !ids.has(item.food.id) && !barcodes.has(item.food.barcode)),
  ];
}
