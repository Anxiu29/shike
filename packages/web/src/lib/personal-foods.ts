import { createId, type FoodEntry, type LibraryFood } from '@shike/shared'
import { applyTypicalPortion } from './typical-portions'

/**
 * 常用库始终复用保存时的完整快照；每次生成独立ID，编辑本餐不会回写库。
 * origin=library表示用户收藏的公共食品，可为首次缺失份量补假设；个人已存快照保持原样。
 * 首页只展示时使用personal-food-display；用户点添加后才按需导入这里的份量依赖。
 */
export function copyLibraryEntry(food: LibraryFood): FoodEntry {
  const entry = JSON.parse(JSON.stringify(food.entry)) as FoodEntry
  entry.id = createId()
  return food.origin === 'library' ? applyTypicalPortion(entry) : entry
}

export { sortedPersonalFoods, personalFoodSymbol } from './personal-food-display'
