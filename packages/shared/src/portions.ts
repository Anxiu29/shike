/**
 * 份量只换算数量与g/mL，不产生营养值：2个×80g=160g；任一因子未知仍返回null。
 * defaultPortion服务于用户选单位；typicalPortion服务于首次未知份量的显式估重提示。
 * 包子80g、饺子20g等都是可修改的产品假设，不是实测标准；二者的规则不能混成一份表。
 * PortionAmountInput已有总量时先保留总量，再让用户核对个数/大小；g与mL不互当密度1。
 * portionSnapshot保存当时单位、数量、单份大小及假设；以后改默认值不回算历史。
 * 新记录自动补份量的位置是web/lib/typical-portions.ts；不能在历史加载/备份恢复时调用。
 */
import type { PortionSnapshot } from './schemas.js';

export const portionUnits = ['个', '根', '块', '碗', '片', '勺', '杯', '份'] as const;
/** 产品参考份量假设，不是人群平均摄入量或膳食建议；只填首次缺失的份量。 */
export function typicalPortion(name: string, basis: PortionSnapshot['basis'] = 'g', category = ''): PortionSnapshot {
  const rules: Array<[RegExp, PortionSnapshot['unit'], number]> = [
    [/小笼包|小笼汤包/, '个', 30], [/包子|肉包|菜包|豆沙包|奶黄包|素包|糖包|馒头/, '个', 80],
    [/饺子|水饺|蒸饺|煎饺/, '个', 20], [/烧麦|烧卖/, '个', 35],
    [/炒饭|焖饭|盖浇饭|拌饭|沙拉|番茄炒蛋|西红柿炒蛋|宫保鸡丁|鱼香肉丝|麻婆豆腐/, '份', 250],
    [/鸡蛋|鸭蛋|皮蛋/, '个', 50],
    [/米饭|白饭/, '碗', 150], [/粥/, '碗', 300], [/面条|汤面|米线|米粉|河粉/, '碗', 300],
    [/吐司|切片面包/, '片', 25], [/香蕉/, '根', 100], [/苹果|梨|桃子|橙子/, '个', 150],
    [/牛奶|豆浆|酸奶|咖啡|奶茶|果汁|饮料|茶水/, '杯', 250],
    [/食用油|橄榄油|菜籽油|花生油/, '勺', 10], [/坚果|核桃|杏仁|瓜子|花生/, '份', 20],
    [/饼干|薯片|巧克力|糖果/, '份', 30], [/汤|羹/, '碗', 250],
  ];
  const match = rules.find(([pattern]) => pattern.test(name));
  const unit = match?.[1] ?? (basis === 'ml' ? '杯' : '份');
  const categories: Record<string, number> = { 肉类: 100, 水产: 100, 蔬菜: 150, 水果: 150, 坚果种子: 20, 油脂调味: 10, 零食: 30, 熟食菜肴: 250 };
  const amount = basis === 'ml' ? 250 : match?.[2] ?? categories[category] ?? 200;
  return { unit, quantity: 1, amountPerUnit: amount, basis, assumption: `常见份量估算：暂按1${unit}${amount}${basis === 'ml' ? 'mL' : 'g'}可食部分；未称重，可按实际份量修改。` };
}
/** 这些是应用的可修改大小假设，不是营养数据库的实测份量，不参与修改每100g营养。 */
export function defaultPortion(name: string, unit: PortionSnapshot['unit'], basis: PortionSnapshot['basis']): PortionSnapshot {
  let amount = basis === 'ml' ? ({ 个: 100, 根: 100, 块: 50, 碗: 250, 片: 30, 勺: 15, 杯: 250, 份: 250 }[unit]) : ({ 个: 100, 根: 100, 块: 50, 碗: 200, 片: 30, 勺: 15, 杯: 250, 份: 100 }[unit]);
  let size = '通用份量，尚未确认具体大小';
  if (basis === 'g' && unit === '个') {
    const rule = [
      [/小笼包|小笼汤包/, 30, '中等小笼包'], [/包子|肉包|菜包|豆沙包|奶黄包|素包|糖包/, 80, '中等包子'],
      [/饺子|水饺|蒸饺|煎饺/, 20, '中等饺子'], [/烧麦|烧卖/, 35, '中等烧麦'], [/馒头/, 80, '中等馒头'],
      [/鸡蛋|鸭蛋|皮蛋/, 50, '去壳可食部分'], [/香蕉/, 100, '去皮可食部分'], [/苹果|梨/, 150, '中等果实可食部分'],
    ].find(([pattern]) => (pattern as RegExp).test(name));
    if (rule) { amount = rule[1] as number; size = rule[2] as string; }
  } else if (basis === 'g' && unit === '根' && /香蕉/.test(name)) { amount = 100; size = '去皮香蕉可食部分'; }
  else if (basis === 'g' && unit === '根' && /香肠|火腿肠|烤肠/.test(name)) { amount = 50; size = '中等肠类，优先核对包装净含量'; }
  else if (basis === 'g' && unit === '碗' && /米饭|白饭/.test(name)) { amount = 150; size = '一小碗熟米饭'; }
  else if (basis === 'g' && unit === '碗' && /粥|汤|面条|面汤/.test(name)) { amount = 250; size = '中等一碗，含水量与盛装量不确定'; }
  else if (basis === 'g' && unit === '片' && /面包|吐司/.test(name)) { amount = 25; size = '普通切片面包'; }
  return { unit, quantity: 1, amountPerUnit: amount, basis, assumption: `默认估重：${size}，暂按每${unit}${amount}${basis === 'ml' ? 'mL' : 'g'}；不是实测，请按实际大小修改。` };
}
export function portionAmount(portion: PortionSnapshot): number | null {
  const { quantity, amountPerUnit } = portion;
  if (quantity === null || amountPerUnit === null || !Number.isFinite(quantity) || !Number.isFinite(amountPerUnit) || quantity < 0 || amountPerUnit <= 0) return null;
  const value = Math.round((quantity * amountPerUnit + Number.EPSILON) * 100) / 100;
  return value <= 20000 ? value : null;
}
