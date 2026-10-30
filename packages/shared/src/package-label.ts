/**
 * 包装标签保留原标注基准和单位，计算时再换算；它优先于同名普通食物。
 * 因子来自实际摄入量与每100g/100mL/份/包基准；g与mL不能假设密度1互换。
 * kJ除4.184转kcal；未知保持null，不从NRV%或三大营养素倒推原标签热量。
 * 标签、份大小、净含量与摄入量保存为快照，后续商品库更新不重算历史。
 * 请求/字段实例保留在docs/packaged-food.md与open-food-facts.md。
 */
import type { FoodEntry, Nutrients, PackageLabel, PackageSnapshot } from './schemas.js';
import { createId } from './id.js';

const empty = (): Nutrients => ({ energyKcal: null, proteinG: null, fatG: null, carbsG: null });
export const emptyPackageLabel = (): PackageLabel => ({ basis: 'unknown', energy: null, proteinG: null, fatG: null, carbsG: null, servingSize: null, netContent: null });
/** 保留标签原单位，只有计算时才换算：1 kcal = 4.184 kJ，不从 NRV% 或宏量反推热量。 */
export function labelNutrients(label: PackageLabel): Nutrients {
  return { energyKcal: label.energy === null ? null : label.energy.unit === 'kJ' ? label.energy.value / 4.184 : label.energy.value,
    proteinG: label.proteinG, fatG: label.fatG, carbsG: label.carbsG };
}
export function labelBasis(label: PackageLabel): { amount: number; unit: 'g' | 'ml' | 'serving' } | null {
  if (label.basis === '100g') return { amount: 100, unit: 'g' };
  if (label.basis === '100ml') return { amount: 100, unit: 'ml' };
  if (label.basis === 'serving') return { amount: 1, unit: 'serving' };
  if (label.basis === 'package') return label.netContent;
  return null;
}
/**
 * 求本次摄入相当于多少个“标签基准”。只有单位兼容或有明确份大小/净含量才换算。
 * 例如每100mL标注、实际喝250mL，factor=2.5；若只有克数而标签按mL，保持未知。
 */
export function packageFactor(snapshot: PackageSnapshot): number | null {
  const { label, consumedAmount: amount, consumedUnit: unit } = snapshot;
  if (amount === null || !Number.isFinite(amount) || amount < 0) return null;
  if (amount === 0) return 0;
  if (label.basis === 'unknown') return null;
  if (label.basis === 'package' && unit === 'package') return amount;
  if (label.basis === 'serving' && unit === 'serving') return amount;
  // 先把份／包换成标签明确给出的质量或体积，不假设饮料密度。
  const consumed = unit === 'package' ? label.netContent && { amount: amount * label.netContent.amount, unit: label.netContent.unit }
    : unit === 'serving' ? label.servingSize && { amount: amount * label.servingSize.amount, unit: label.servingSize.unit }
    : { amount, unit };
  if (!consumed) return null;
  const basis = label.basis === 'serving' ? label.servingSize : label.basis === 'package' ? label.netContent : labelBasis(label);
  return basis && basis.unit === consumed.unit ? consumed.amount / basis.amount : null;
}
export function packageNutrients(snapshot: PackageSnapshot): Nutrients {
  const result = labelNutrients(snapshot.label), factor = packageFactor(snapshot);
  for (const key of Object.keys(result) as (keyof Nutrients)[]) result[key] = factor === 0 ? 0 : factor === null || result[key] === null ? null : result[key]! * factor;
  return result;
}
/** 与旧记录的每100g字段兼容；体积标签没有质量依据时保持 null，不能把 mL 写成 g。 */
export function packageNutrientsPer100g(label: PackageLabel): Nutrients {
  const basis = label.basis === 'serving' ? label.servingSize : label.basis === 'package' ? label.netContent : labelBasis(label);
  if (!basis || basis.unit !== 'g') return empty();
  const result = labelNutrients(label);
  for (const key of Object.keys(result) as (keyof Nutrients)[]) if (result[key] !== null) result[key] = result[key]! * 100 / basis.amount;
  return result;
}
export function packageWeight(snapshot: PackageSnapshot): number | null {
  if (snapshot.consumedAmount === null) return null;
  const measure = snapshot.consumedUnit === 'g' ? { amount: 1, unit: 'g' }
    : snapshot.consumedUnit === 'package' ? snapshot.label.netContent
    : snapshot.consumedUnit === 'serving' ? snapshot.label.servingSize : null;
  return measure?.unit === 'g' ? snapshot.consumedAmount * measure.amount : null;
}
/** 包装修改后同步供普通列表展示的字段；计算仍以packageSnapshot为准，不能丢弃原单位。 */
export function syncPackageEntry(entry: FoodEntry): void {
  if (!entry.packageSnapshot) return;
  entry.weightG = packageWeight(entry.packageSnapshot);
  entry.nutrientsPer100g = packageNutrientsPer100g(entry.packageSnapshot.label);
}
export function createPackageEntry(name: string, label: PackageLabel, provider: PackageSnapshot['provider'], model: string): FoodEntry {
  const unit = label.basis === 'package' ? 'package' : label.basis === '100g' ? 'g' : label.basis === '100ml' ? 'ml' : label.servingSize?.unit ?? 'serving';
  return { id: createId(), name, kind: 'label', weightG: null, nutrientsPer100g: packageNutrientsPer100g(label),
    packageSnapshot: { label: JSON.parse(JSON.stringify(label)), consumedAmount: null, consumedUnit: unit, provider, model, manuallyEdited: provider === 'manual' },
    provenance: provider === 'manual' ? '用户填写包装营养表，按实际摄入量换算，非实测。' : `包装营养表 · ${provider === 'offline' ? '本机离线 AI 读取（试验）' : 'AI 读取'}，需核对原标签；按实际摄入量换算，非实测。`,
    warnings: ['请核对标签数字、计量基准与实际摄入量；净含量不是已吃份量。'] };
}
