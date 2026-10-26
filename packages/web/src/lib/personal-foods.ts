import { createId, type FoodEntry, type LibraryFood } from '@shike/shared'
import { applyTypicalPortion } from './typical-portions'

/** 常用库始终复用保存时的完整快照；每次生成独立ID，编辑本餐不会回写库。 */
export function copyLibraryEntry(food: LibraryFood): FoodEntry {
  const entry = JSON.parse(JSON.stringify(food.entry)) as FoodEntry
  entry.id = createId()
  return food.origin === 'library' ? applyTypicalPortion(entry) : entry
}

export function sortedPersonalFoods(foods: LibraryFood[]): LibraryFood[] {
  return [...foods].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
}

export function personalFoodSymbol(entry: FoodEntry): string {
  if (entry.packageSnapshot) return '📦'
  if (/奶|豆浆|豆乳|咖啡|茶|饮|汁/.test(entry.name)) return '🥛'
  if (/饭|米|粥/.test(entry.name)) return '🍚'
  if (/包|面|饼|吐司/.test(entry.name)) return '🥯'
  if (/蛋/.test(entry.name)) return '🥚'
  if (/肉|鸡|牛|排/.test(entry.name)) return '🍗'
  if (/果|蕉|橘|橙|莓|桃/.test(entry.name)) return '🍎'
  if (/菜|瓜|沙拉/.test(entry.name)) return '🥬'
  return '🍽️'
}
