// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import DateField from '../src/components/DateField.vue'
import { backLayers } from '../src/lib/use-back-layer'
import { localDate } from '../src/lib/dates'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ''; expect(backLayers.hasActive).toBe(false) })
async function open(value = '2024-01-31') {
  wrapper = mount(DateField, { attachTo: document.body, props: { modelValue: value }, attrs: { 'data-testid': 'date-field' }, global: { stubs: { teleport: true } } })
  await wrapper.get('[data-testid="date-field"]').trigger('click')
  return wrapper
}

it('日期只读且没有清除按钮，删除键不清空或提交', async () => {
  const form = await open()
  expect(form.get('[data-testid="date-field"]').attributes()).toHaveProperty('readonly')
  expect(form.text()).not.toMatch(/清除|清空/)
  await form.get('[data-testid="date-field"]').trigger('keydown', { key: 'Delete' })
  expect(form.emitted('update:modelValue')).toBeUndefined()
  expect(form.get('[data-testid="date-field"]').element).toHaveProperty('value', '2024-01-31')
})
it('选择闰年2月29日后，只有确定才提交日期', async () => {
  const form = await open()
  await form.get('[data-testid="calendar-month"]').setValue('2')
  await form.get('[data-testid="calendar-day-2024-02-29"]').trigger('click')
  expect(form.emitted('update:modelValue')).toBeUndefined()
  await form.get('[data-testid="calendar-confirm"]').trigger('click')
  expect(form.emitted('update:modelValue')).toEqual([['2024-02-29']])
  expect(form.find('[data-testid="calendar-sheet"]').exists()).toBe(false)
})
it('跨年翻月与平年日数正确，取消保留原日期', async () => {
  const form = await open('2024-12-31')
  await form.get('[data-testid="calendar-next-month"]').trigger('click')
  expect(form.get('[data-testid="calendar-year"]').element).toHaveProperty('value', '2025')
  await form.get('[data-testid="calendar-month"]').setValue('2')
  expect(form.find('[data-testid="calendar-day-2025-02-29"]').exists()).toBe(false)
  await form.get('[data-testid="calendar-day-2025-02-28"]').trigger('click')
  await form.get('[data-testid="calendar-cancel"]').trigger('click')
  expect(form.emitted('update:modelValue')).toBeUndefined()
  expect(form.get('[data-testid="date-field"]').element).toHaveProperty('value', '2024-12-31')
})
it('年份留空、小数或越界时恢复原年份，不产生无效日期', async () => {
  const form = await open()
  for (const value of ['', '0', '2024.5', '10000']) {
    await form.get('[data-testid="calendar-year"]').setValue(value)
    expect(form.get('[data-testid="calendar-year"]').element).toHaveProperty('value', '2024')
  }
  await form.get('[data-testid="calendar-confirm"]').trigger('click')
  expect(form.emitted('update:modelValue')).toEqual([['2024-01-31']])
})
it('日期方向键跨月移动焦点，不自动修改记录日期', async () => {
  const form = await open()
  await form.get('[data-testid="calendar-day-2024-01-31"]').trigger('keydown', { key: 'ArrowRight' })
  expect(document.activeElement).toBe(form.get('[data-testid="calendar-day-2024-02-01"]').element)
  expect(form.emitted('update:modelValue')).toBeUndefined()
})
it('回到今天仍需确认，重新打开从实际记录日期开始', async () => {
  const form = await open()
  await form.get('[data-testid="calendar-today"]').trigger('click')
  expect(form.emitted('update:modelValue')).toBeUndefined()
  await form.get('[data-testid="calendar-cancel"]').trigger('click')
  await form.get('[data-testid="date-field"]').trigger('keydown', { key: 'Enter' })
  await form.get('[data-testid="calendar-today"]').trigger('click')
  await form.get('[data-testid="calendar-confirm"]').trigger('click')
  expect(form.emitted('update:modelValue')).toEqual([[localDate()]])
})
it('安卓返回只关闭日历，不清空日期或关闭下层编辑页', async () => {
  const parentClose = vi.fn(), fallback = vi.fn(), parent = backLayers.add(parentClose)
  try {
    const form = await open()
    await backLayers.back(fallback)
    expect(parentClose).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled()
    expect(form.find('[data-testid="calendar-sheet"]').exists()).toBe(false)
    expect(form.emitted('update:modelValue')).toBeUndefined()
  } finally { parent.remove() }
})
