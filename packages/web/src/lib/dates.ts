/** 使用本机日历日期，避免 toISOString() 的 UTC 转换让夜间记录错一天。 */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function shiftDate(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number)
  return localDate(new Date(year!, month! - 1, day! + amount, 12))
}

export function dateLabel(value: string): string {
  const date = new Date(`${value}T12:00:00`)
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
}

export function numberLabel(value: number | null | undefined, digits = 0): string {
  return value == null ? '待补充' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

export function rangeLabel(range: { min: number; max: number } | null | undefined): string {
  return range ? `${numberLabel(range.min, 1)}–${numberLabel(range.max, 1)}` : '待补充'
}
