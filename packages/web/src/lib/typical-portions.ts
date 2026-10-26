import { findFood, typicalPortion, portionAmount, syncPackageEntry, type FoodEntry } from '@shike/shared'
import { resizeEntry } from './entries'
/** 只补首次缺失值；0、用户已填写值和历史快照绝不覆盖。 */
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
