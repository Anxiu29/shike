/**
 * 展示精简规则，不是营养等价判定：同类别/语义/状态才比较每100g的四项阈值。
 * 保留糖、配料、做法；生/干与熟食分开，明确无油和加油不能互并，缺营养值不自动合并。
 * 每个新成员须与全组每一项兼容，禁止100→105→110 kcal这种传递合并。
 * 代表项优先既有基础库，再按说明明确程度、名称长度与ID排序；保留原值，不求平均。
 * 例：中粒/短粒熟白米饭可指向已有熟白米饭，旧名称成为别名；foods保留全部旧ID，
 * 历史继续用自己的营养快照。阈值随摄入重量放大，未比较的微量营养素仍可能不同。
 * 重建报告：npm run build -w @shike/shared，然后node scripts/report-food-curation.mjs；
 * 明细在shared/data/food-curation-report.json；回归在shared/tests/food-curation.test.ts。
 */
import type { FoodDefinition } from './food-data.js';

// 每100g的记账近似阈值，不表示这些食物的全部微量营养素相同。
export const foodMergeLimits = { energyKcal: 5, proteinG: 1, fatG: 1, carbsG: 2 } as const;
type FatQualifier = '' | 'unknown' | 'added' | 'none';
type Candidate = { food: FoodDefinition; key: string; fat: FatQualifier };
export interface FoodConsolidation { representativeId: string; memberIds: string[] }
const labelKey = (value: string) => value.trim().toLowerCase().replace(/[\s（）()]/g, '');
const optionalQualifier = /^(?:nfs|ns as to (?:type|variety|brand|flavor)|regular|enriched|unenriched|fortified|unfortified|with added salt|without added salt|without salt|with salt|salt added|no salt added|salt not added)$/;

function candidate(food: FoodDefinition): Candidate {
  let description = food.source.description.toLowerCase().replace(/[–—]/g, '-');
  // 只忽略米的粒型；白米、糙米、糯米、即食、烹调方式仍留在语义键中。
  if (/^rice[, ]/.test(description)) description = description.replace(/\b(?:long|medium|short)[ -]grain\b/g, '');
  let fat: FatQualifier = '';
  const parts = description.split(',').map(part => part.trim()).filter(part => {
    if (/^(?:ns as to fat added in cooking|ns as to fat|ns as to type of fat|ns as to cooking fat)$/.test(part)) { fat = 'unknown'; return false; }
    if (/^(?:fat added in cooking|fat added)$/.test(part)) { fat = 'added'; return false; }
    if (/^(?:no added fat|no added fat or salt|no fat added|no added fat or oil)$/.test(part)) { fat = 'none'; return false; }
    return part !== '' && !optionalQualifier.test(part);
  });
  const name = parts.join(',').replace(/[\s,;()-]+/g, ' ').trim();
  const state = food.state === 'ready' || food.state === 'cooked' ? 'prepared' : food.state;
  return { food, fat, key: `${food.category}|${state}|${name}` };
}
function compatible(a: Candidate, b: Candidate): boolean {
  // 未注明用油可以与近似的明确版本合并；明确无油和加油绝不互相合并。
  if (a.fat && b.fat && a.fat !== 'unknown' && b.fat !== 'unknown' && a.fat !== b.fat) return false;
  return Object.entries(foodMergeLimits).every(([key, limit]) => {
    const x = a.food.nutrientsPer100g[key as keyof typeof foodMergeLimits], y = b.food.nutrientsPer100g[key as keyof typeof foodMergeLimits];
    return x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= limit + 1e-8;
  });
}
function preference(food: FoodDefinition): number {
  return (food.source.dataset === 'USDA SR Legacy' ? 0 : 10000) + (/未注明|未说明|NS as to|NFS/i.test(food.name + food.source.description) ? 1000 : 0) + food.name.length;
}

/** 精简供新记录选择的库。原始库、配方原料ID和历史快照保持可访问，不平均或伪造营养值。 */
export function curateFoodCatalog(input: readonly FoodDefinition[]) {
  const buckets = new Map<string, Candidate[][]>(), groups: Candidate[][] = [];
  for (const food of input) {
    const item = candidate(food), bucket = buckets.get(item.key) ?? [];
    // 每个成员都要互相满足阈值，避免100→105→110的传递合并。
    const group = bucket.find(existing => existing.every(other => compatible(item, other)));
    if (group) group.push(item);
    else { const created = [item]; bucket.push(created); groups.push(created); }
    buckets.set(item.key, bucket);
  }
  const owners = new Map(input.flatMap(food => [food.name, ...food.aliases].map(name => [labelKey(name), food.id] as const)));
  const consolidations: FoodConsolidation[] = [];
  const foods = groups.map(group => {
    const representative = [...group].sort((a, b) => preference(a.food) - preference(b.food) || a.food.id.localeCompare(b.food.id))[0]!.food;
    if (group.length === 1) return representative;
    const members = new Set(group.map(item => item.food.id)), seen = new Set([labelKey(representative.name)]), aliases: string[] = [];
    for (const { food } of group) {
      const shortName = food.name.replace(/[（(](?:熟|熟制|熟重)[）)]$/, '');
      for (const name of [food.name, ...food.aliases, shortName]) {
        const key = labelKey(name), owner = owners.get(key);
        if (key && !seen.has(key) && (!owner || members.has(owner))) { aliases.push(name); seen.add(key); owners.set(key, representative.id); }
      }
    }
    consolidations.push({ representativeId: representative.id, memberIds: group.map(item => item.food.id) });
    return { ...representative, aliases, nutrientsPer100g: { ...representative.nutrientsPer100g }, source: { ...representative.source } };
  });
  return { foods, consolidations, removedCount: input.length - foods.length };
}
