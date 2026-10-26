import { afterEach, describe, expect, it, vi } from 'vitest'
import { suggestedMealType } from '../src/lib/dates'

afterEach(() => vi.useRealTimers())

describe('设备本地时间的默认餐次', () => {
  it.each([
    [0, 0, 'snack'], [4, 59, 'snack'],
    [5, 0, 'breakfast'], [10, 59, 'breakfast'],
    [11, 0, 'lunch'], [14, 59, 'lunch'],
    [15, 0, 'snack'], [16, 59, 'snack'],
    [17, 0, 'dinner'], [21, 59, 'dinner'],
    [22, 0, 'snack'], [23, 59, 'snack'],
  ] as const)('%i:%i 默认 %s', (hour, minute, expected) => {
    // 用本地构造器，规则不依赖UTC日期、服务端时区或某种食物。
    expect(suggestedMealType(new Date(2026, 9, 21, hour, minute))).toBe(expected)
  })

  it('每次调用读取当前时刻，页面长时间打开后仍更新建议', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 21, 10, 59))
    expect(suggestedMealType()).toBe('breakfast')
    vi.setSystemTime(new Date(2026, 9, 21, 11, 0))
    expect(suggestedMealType()).toBe('lunch')
    vi.setSystemTime(new Date(2026, 9, 22, 0, 0))
    expect(suggestedMealType()).toBe('snack')
  })
})
