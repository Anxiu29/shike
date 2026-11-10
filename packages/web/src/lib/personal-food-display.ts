import type { FoodEntry, LibraryFood } from '@shike/shared'

/** 展示辅助保持轻量：排序、图标和已存营养快照不需要加载完整食品库。 */
export function sortedPersonalFoods(foods: LibraryFood[]): LibraryFood[] {
  // 先复制再排序，避免直接改变父组件传来的响应式数组。
  return [...foods].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
}

/** 图标只是名称提示，不参与食品匹配、营养判断或分类事实。 */
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
