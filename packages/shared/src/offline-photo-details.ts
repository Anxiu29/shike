import { z } from 'zod';
import { normalizeFoodName, packageLabelSchema, type PackageLabel } from './schemas.js';

export const offlineWeightPrompt = '识别照片中能确认的主要食物，最多6种，每种一次；估算每种可食部分重量克数estimatedWeightG，没有把握填null。不要把个数当克数，不猜隐藏配料，不输出营养。不是食物返回foods空数组。只返回规定JSON。';
export const offlineLabelPrompt = '读取包装营养表同一列原始数值，按规定JSON返回。name为商品名，看不清填包装食品。basis为100g/100ml/serving/package，未读清填unknown。energyValue及energyUnit保留kJ或kcal原值；proteinG/fatG/carbsG只抄克数，不抄NRV%。servingAmount/servingUnit为每份大小，netAmount/netUnit为净含量，单位g或ml；看不清填null，不猜、不换算、不推断吃完。evidence简短抄出所读基准和营养那一列用于核对。';
const nameSchema = z.string().trim().min(1).max(40).refine(name => !/[{}\[\]`<>\r\n]/.test(name), '名称格式无效');
const weightSchema = z.object({ foods: z.array(z.object({ name: nameSchema, estimatedWeightG: z.number().finite().positive().max(20000).nullable() }).strict()).max(6) }).strict();
const numeric = z.number().finite().min(0).max(100000).nullable();
const measure = z.number().finite().positive().max(20000).nullable();
const unit = z.enum(['g', 'ml']).nullable();
const labelReadSchema = z.object({
  name: nameSchema, basis: z.enum(['100g', '100ml', 'serving', 'package', 'unknown']),
  energyValue: numeric, energyUnit: z.enum(['kJ', 'kcal']).nullable(),
  proteinG: z.number().finite().min(0).max(5000).nullable(), fatG: z.number().finite().min(0).max(5000).nullable(), carbsG: z.number().finite().min(0).max(5000).nullable(),
  servingAmount: measure, servingUnit: unit, netAmount: measure, netUnit: unit,
  evidence: z.string().trim().max(200),
}).strict();
export type OfflineImageResult =
  | { kind: 'food'; foods: { name: string; estimatedWeightG: number | null }[]; warnings: string[] }
  | { kind: 'label'; name: string; label: PackageLabel; evidence: string; warnings: string[] };
function json(raw: string): unknown {
  if (!raw.trim() || raw.length > 5000) throw new Error('本机模型未返回完整JSON，原草稿保留。请重拍或重试。');
  try { return JSON.parse(raw); } catch { throw new Error('本机模型回答被截断或格式不完整，原草稿保留。请重试或改用仅名称。'); }
}
export function parseOfflineWeights(raw: string): OfflineImageResult & { kind: 'food' } {
  const parsed = weightSchema.safeParse(json(raw));
  if (!parsed.success) throw new Error('本机估重字段无效，原草稿保留。请重试或改用仅名称。');
  const seen = new Set<string>();
  for (const food of parsed.data.foods) {
    const key = normalizeFoodName(food.name);
    if (seen.has(key)) throw new Error('本机识图出现重复食物，原草稿保留。请重试或改用仅名称。');
    seen.add(key);
  }
  return { kind: 'food', foods: parsed.data.foods, warnings: ['本机照片估重为试验功能，可能偏差较大，不是称重结果；请核对食物及克数。营养由所选食物库或配方计算。'] };
}
export function parseOfflineLabel(raw: string): OfflineImageResult & { kind: 'label' } {
  const parsed = labelReadSchema.safeParse(json(raw));
  if (!parsed.success) throw new Error('本机营养表字段或单位无效，原草稿保留。请贴近拍清营养表再试。');
  const value = parsed.data, warnings = ['本机营养表识读为试验功能，请对照原照片核对同一列的数值、单位与基准；净含量不代表已吃份量。'];
  const label = packageLabelSchema.safeParse({ basis: value.basis,
    energy: value.energyValue !== null && value.energyUnit !== null ? { value: value.energyValue, unit: value.energyUnit } : null,
    proteinG: value.proteinG, fatG: value.fatG, carbsG: value.carbsG,
    servingSize: value.servingAmount !== null && value.servingUnit !== null ? { amount: value.servingAmount, unit: value.servingUnit } : null,
    netContent: value.netAmount !== null && value.netUnit !== null ? { amount: value.netAmount, unit: value.netUnit } : null,
  });
  if (!label.success) throw new Error('本机营养表数值与基准不相符，原草稿保留。请核对原照片后手动填写。');
  if (value.energyValue !== null && value.energyUnit === null) warnings.push(`能量读到 ${value.energyValue}，原单位未读清，未带入能量字段。`);
  if (value.servingAmount !== null && value.servingUnit === null) warnings.push(`每份大小读到 ${value.servingAmount}，单位未读清，未带入。`);
  if (value.netAmount !== null && value.netUnit === null) warnings.push(`净含量读到 ${value.netAmount}，单位未读清，未带入。`);
  if (label.data.energy === null && [value.proteinG, value.fatG, value.carbsG].every(v => v === null)) throw new Error('没有读清可用的营养数值。请贴近拍摄营养表，或手动填写。照片与原草稿保留。');
  if (value.basis === 'unknown') warnings.push('营养表基准未读清，补全基准前不计算摄入营养。');
  if (value.evidence) warnings.push(`本机抄录（需对照照片）：${value.evidence}`);
  return { kind: 'label', name: value.name, label: label.data, evidence: value.evidence, warnings };
}
