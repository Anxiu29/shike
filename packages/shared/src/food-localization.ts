import type { FoodDefinition } from './food-data.js';
import { foodNameTranslations } from './food-names.zh.generated.js';

/** 仅替换新记录的展示名称，旧名称作为唯一别名保留；来源与营养引用保持原样。 */
export function localizeFoodNames(input: readonly FoodDefinition[]): FoodDefinition[] {
  const key = (value: string) => value.trim().toLowerCase().replace(/[\s（）()]/g, '');
  const owners = new Map(input.flatMap(food => [food.name, ...food.aliases].map(name => [key(name), food.id] as const)));
  for (const food of input) {
    const translation = foodNameTranslations[food.id];
    if (translation && (!owners.has(key(translation.name)) || owners.get(key(translation.name)) === food.id)) owners.set(key(translation.name), food.id);
  }
  return input.map(food => {
    const translation = foodNameTranslations[food.id];
    if (!translation || owners.get(key(translation.name)) !== food.id) return food;
    const used = new Set([key(translation.name)]);
    const aliases = [food.name, ...food.aliases].filter(name => {
      const normalized = key(name);
      if (used.has(normalized) || owners.get(normalized) !== food.id) return false;
      used.add(normalized); return true;
    });
    return { ...food, name: translation.name, originalName: food.source.description, aliases };
  });
}
