// @vitest-environment happy-dom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defaultDailyGoals, type Settings } from '@shike/shared'
import GoalsView from '../src/views/GoalsView.vue'
import WeightView from '../src/views/WeightView.vue'
import { localDate } from '../src/lib/dates'
import { saveSettings } from '../src/lib/db'

vi.mock('../src/lib/db', () => ({ saveSettings: vi.fn(), saveWeight: vi.fn(), deleteWeight: vi.fn() }))
let wrapper: VueWrapper | undefined
const settings = (): Settings => ({ targetWeightKg: 65, personalInfo: { sex: 'male', age: 30, heightCm: 175, startingWeightKg: 70, startingDate: localDate(), activityLevel: 'sedentary', autoEstimateAllowed: true }, dailyGoals: { ...defaultDailyGoals, waterMl: 1800 } })
beforeEach(() => { vi.mocked(saveSettings).mockResolvedValue(undefined) })
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.resetAllMocks() })

it('目标页保留未保存的身高，同时同步体重页的新目标，保存只提交已编辑字段', async () => {
  wrapper = mount(GoalsView, { props: { settings: settings(), weights: [] } })
  await wrapper.get('[data-testid="profile-height"]').setValue('180')
  await wrapper.setProps({ settings: { ...settings(), targetWeightKg: 64 } })
  expect(wrapper.get('[data-testid="profile-height"]').element).toHaveProperty('value', '180')
  expect(wrapper.get('[data-testid="goal-target-weight"]').element).toHaveProperty('value', '64')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(saveSettings).toHaveBeenCalledWith({ personalInfo: { heightCm: 180 } })
})

it('同字段有本地草稿时保留输入，其它目标字段继续同步', async () => {
  wrapper = mount(GoalsView, { props: { settings: settings(), weights: [] } })
  await wrapper.get('[data-testid="goal-target-weight"]').setValue('62')
  await wrapper.setProps({ settings: { ...settings(), targetWeightKg: 64, dailyGoals: { ...defaultDailyGoals, waterMl: 2000 } } })
  expect(wrapper.get('[data-testid="goal-target-weight"]').element).toHaveProperty('value', '62')
  expect(wrapper.get('[data-testid="water-goal"]').element).toHaveProperty('value', '2000')
  await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(saveSettings).toHaveBeenCalledWith({ targetWeightKg: 62 })
})

it('保存等待期间继续输入的资料不会被误标为已保存', async () => {
  let finish!: () => void
  vi.mocked(saveSettings).mockReturnValue(new Promise(resolve => { finish = resolve }))
  wrapper = mount(GoalsView, { props: { settings: settings(), weights: [] } })
  await wrapper.get('[data-testid="profile-height"]').setValue('180'); await wrapper.get('form').trigger('submit')
  await wrapper.get('[data-testid="profile-height"]').setValue('185')
  finish(); await flushPromises()
  expect(wrapper.get('[data-testid="save-goals"]').attributes('disabled')).toBeUndefined()
  expect(wrapper.text()).toContain('有修改未保存')
})

it('切换回自动预算时清除手动预算，仅提交相关目标字段', async () => {
  wrapper = mount(GoalsView, { props: { settings: { ...settings(), dailyGoals: { ...defaultDailyGoals, calorieMode: 'manual', manualCaloriesKcal: 1800 } }, weights: [] } })
  await wrapper.get('[data-testid="calorie-mode"]').setValue('auto'); await wrapper.get('form').trigger('submit'); await flushPromises()
  expect(saveSettings).toHaveBeenCalledWith({ dailyGoals: { calorieMode: 'auto', manualCaloriesKcal: null } })
})

it('体重页先显示个人资料参考，记录后采用当日体重，不把未来体重用作当前值', async () => {
  wrapper = mount(WeightView, { props: { settings: settings(), weights: [] } })
  expect(wrapper.get('[data-testid="current-weight"]').text()).toContain('70')
  expect(wrapper.get('[data-testid="current-weight-source"]').text()).toContain('个人资料参考')
  const now = new Date().toISOString()
  await wrapper.setProps({ weights: [{ date: localDate(), weightKg: 69, updatedAt: now }, { date: '2099-01-01', weightKg: 85, updatedAt: now }] })
  expect(wrapper.get('[data-testid="current-weight"]').text()).toContain('69')
  expect(wrapper.get('[data-testid="current-weight-source"]').text()).toContain('体重记录')
})

it('体重页同步更新未编辑的目标输入框，不覆盖正在填写的目标', async () => {
  wrapper = mount(WeightView, { props: { settings: settings(), weights: [] } })
  await wrapper.setProps({ settings: { ...settings(), targetWeightKg: 64 } })
  expect(wrapper.get('[data-testid="target-weight"]').element).toHaveProperty('value', '64')
  await wrapper.get('[data-testid="target-weight"]').setValue('62')
  await wrapper.setProps({ settings: { ...settings(), targetWeightKg: 63 } })
  expect(wrapper.get('[data-testid="target-weight"]').element).toHaveProperty('value', '62')
})
