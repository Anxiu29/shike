import { findFood, typicalPortion, portionAmount, syncPackageEntry, type FoodEntry } from '@shike/shared'
import { resizeEntry } from './entries'
/** 只补首次缺失值；0、用户已填写值和历史快照绝不覆盖。 */
export function applyTypicalPortion(entry: FoodEntry): FoodEntry {
  if (entry.packageSnapshot) {
    const snapshot = entry.packageSnapshot
    if (snapshot.consumedAmount !== null || snapshot.label.basis === 'unknown') return entry
    // 标签的一份可以作为明确标注的参考量；没有每份资料时不再套100/200g通用重量。
    if (snapshot.label.servingSize) {
      snapshot.consumedAmount = 1; snapshot.consumedUnit = 'serving'; syncPackageEntry(entry)
      entry.warnings = [...new Set([...entry.warnings, '标签参考份量：暂按标签1份，未确认实际摄入；单独小包不一定等于标签一份，请核对。'])].slice(0, 30)
    } else entry.warnings = [...new Set([...entry.warnings, '单个/小包大小待确认：请使用AI估重或填写实际重量，不按通用份量或外包装总重代替。'])].slice(0, 30)
    return entry
  }
  if ((entry.volumeSnapshot ? entry.volumeSnapshot.amountMl : entry.weightG) !== null) return entry
  const portion = typicalPortion(entry.name, entry.volumeSnapshot ? 'ml' : 'g', findFood(entry.name)?.category)
  if (entry.volumeSnapshot) entry.volumeSnapshot.amountMl = portionAmount(portion)
  else resizeEntry(entry, portionAmount(portion))
  entry.portionSnapshot = portion
  return entry
}
