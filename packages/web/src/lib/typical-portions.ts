import { findFood, typicalPortion, portionAmount, syncPackageEntry, type FoodEntry } from '@shike/shared'
import { resizeEntry } from './entries'
/**
 * 只在“创建新条目”时补首次缺失份量，不在数据库读取或备份恢复时调用。
 * 0和已有重量/容量不会覆盖；返回同一个可编辑条目，并保存假设说明以便用户修正。
 * 包装按标签已知的g或mL基准补值，普通食品可查分类；这里因此属于需要食品库的创建路径。
 */
export function applyTypicalPortion(entry: FoodEntry): FoodEntry {
  if (entry.packageSnapshot) {
    const snapshot = entry.packageSnapshot
    if (snapshot.consumedAmount !== null || snapshot.label.basis === 'unknown') return entry
    const basis = snapshot.label.basis === '100ml' || snapshot.label.netContent?.unit === 'ml' || snapshot.label.servingSize?.unit === 'ml' ? 'ml' : 'g'
    const portion = typicalPortion(entry.name, basis)
    snapshot.consumedAmount = portionAmount(portion); snapshot.consumedUnit = basis; syncPackageEntry(entry)
    entry.warnings = [...new Set([...entry.warnings, portion.assumption])].slice(0, 30)
    return entry
  }
  if ((entry.volumeSnapshot ? entry.volumeSnapshot.amountMl : entry.weightG) !== null) return entry
  const portion = typicalPortion(entry.name, entry.volumeSnapshot ? 'ml' : 'g', findFood(entry.name)?.category)
  if (entry.volumeSnapshot) entry.volumeSnapshot.amountMl = portionAmount(portion)
  else resizeEntry(entry, portionAmount(portion))
  entry.portionSnapshot = portion
  return entry
}
