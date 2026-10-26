// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import DiaryWeek from '../src/components/DiaryWeek.vue'
import { backLayers } from '../src/lib/use-back-layer'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ''; expect(backLayers.hasActive).toBe(false) })
function open() {
  wrapper = mount(DiaryWeek, { attachTo: document.body, props: { date: '2026-10-23', meals: [], settings: { targetWeightKg: null }, weights: [], exercises: [], dailyPlans: [] } })
  return wrapper
}
it('键盘可查看整月，浏览其它月份不改饮食日期，外部切日同步月历，返回先收起', async () => {
  const view = open(); await view.get('[data-testid=week-date-2026-10-23]').trigger('keydown', { key: 'PageDown' })
  expect(view.find('[data-testid=toggle-diary-month]').exists()).toBe(false)
  expect(view.text()).not.toContain('上滑查看整月')
  expect(view.get('[data-testid=diary-month]').findAll('button')).toHaveLength(31)
  await view.get('[data-testid=diary-next-month]').trigger('click')
  expect(view.get('[data-testid=diary-month-title]').text()).toBe('2026年11月')
  expect(view.emitted('select')).toBeUndefined()
  await view.setProps({ date: '2024-02-29' })
  expect(view.get('[data-testid=diary-month]').findAll('button')).toHaveLength(29)
  await backLayers.back(() => { throw new Error('月历应先消费返回') })
  expect(view.find('[data-testid=diary-month]').exists()).toBe(false)
})
it('月历方向键跨月选日，Escape收起并恢复到所选日期', async () => {
  const view = open(); await view.get('[data-testid=week-date-2026-10-23]').trigger('keydown', { key: 'PageDown' })
  await view.get('[data-testid=month-date-2026-10-31]').trigger('keydown', { key: 'ArrowRight' })
  expect(view.emitted('select')).toEqual([['2026-11-01']])
  await view.get('[data-testid=month-date-2026-10-23]').trigger('keydown', { key: 'Escape' })
  await expect.poll(() => document.activeElement).toBe(view.get('[data-testid=week-date-2026-10-23]').element)
})
it('触摸轻点直接响应，兼容click不会重复选日', async () => {
  const view = open()
  async function tap(selector: string) {
    const button = view.get(selector)
    await button.trigger('pointerdown', { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: 100, clientY: 200 })
    await button.trigger('pointerup', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 200 })
    await button.trigger('click', { detail: 1 })
  }
  await view.get('[data-testid=week-date-2026-10-23]').trigger('keydown', { key: 'PageDown' })
  expect(view.find('[data-testid=diary-month]').exists()).toBe(true)
  await tap('[data-testid=month-date-2026-10-20]')
  expect(view.emitted('select')).toEqual([['2026-10-20']])
})
