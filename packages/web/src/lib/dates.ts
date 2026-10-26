import type { FoodEntry, MealType } from '@shike/shared'
export function portionLabel(entry: FoodEntry): string {
  if (entry.portionSnapshot) {
    const portion = entry.portionSnapshot, amount = portion.basis === 'ml' ? entry.volumeSnapshot?.amountMl : entry.weightG;
    return `${portion.quantity === null ? '数量待填写' : `${numberLabel(portion.quantity)} ${portion.unit}`} · ${amount == null ? '份量待补充' : `约 ${numberLabel(amount)} ${portion.basis === 'ml' ? 'mL' : 'g'}`}`
  }
  if (entry.volumeSnapshot) return entry.volumeSnapshot.amountMl === null ? '饮用量待补充' : `${numberLabel(entry.volumeSnapshot.amountMl)} mL`
  const snapshot = entry.packageSnapshot
  if (!snapshot) return entry.weightG === null ? '重量待补充' : `${numberLabel(entry.weightG)} g`
  return snapshot.consumedAmount === null ? '摄入量待填写' : `${numberLabel(snapshot.consumedAmount)} ${ { g: 'g', ml: 'mL', serving: '份', package: '包' }[snapshot.consumedUnit] }`
}
/** 使用本机日历日期，避免 toISOString() 的 UTC 转换让夜间记录错一天。 */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 产品默认时段，使用设备本地时间。仅在新建／首次发送时调用，不覆盖草稿或历史餐次。 */
export function suggestedMealType(date = new Date()): MealType {
  const hour = date.getHours()
  if (hour >= 5 && hour < 11) return 'breakfast'
  if (hour >= 11 && hour < 15) return 'lunch'
  if (hour >= 17 && hour < 22) return 'dinner'
  return 'snack'
}

export function shiftDate(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number)
  return localDate(new Date(year!, month! - 1, day! + amount, 12))
}

export function dateLabel(value: string): string {
  const date = new Date(`${value}T12:00:00`)
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
}

export function numberLabel(value: number | null | undefined, digits = 2): string {
  return value == null ? '待补充' : value.toLocaleString('zh-CN', { maximumFractionDigits: Math.min(2, Math.max(0, digits)) })
}

export function rangeLabel(range: { min: number; max: number } | null | undefined): string {
  return range ? `${numberLabel(range.min)}–${numberLabel(range.max)}` : '待补充'
}

/** 输入框不加千分位。仅格式化显示，避免四舍五入破坏区间中值和历史快照。 */
export function inputNumberLabel(value: number | null | undefined): string {
  return value == null ? '' : value.toLocaleString('en-US', { maximumFractionDigits: 2, useGrouping: false })
}
