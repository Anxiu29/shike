// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { applyEstimateLevel, createEstimatedFoodEntry, createPackageEntry, type FoodEntry, type LibraryFood } from '@shike/shared'
import PersonalFoodDetails from '../src/components/PersonalFoodDetails.vue'
import { recognitionEstimate } from '../src/lib/entries'
import { porridgeProfile } from './range-fixture'

function details(entry: FoodEntry) {
  const food: LibraryFood = { id: 'saved-food', choiceId: 'saved:saved-food', origin: 'manual', entry, favorite: false, createdAt: '2026-10-26T00:00:00Z', updatedAt: '2026-10-26T00:00:00Z' }
  return mount(PersonalFoodDetails, { props: { food }, global: { stubs: { AppSheet: { template: '<section><slot /><slot name="footer" /></section>' } } } })
}
const manual = (): FoodEntry => ({ id: 'manual', name: '自制早餐', weightG: 150, kind: 'manual', nutrientsPer100g: { energyKcal: 80, proteinG: 10, fatG: 0, carbsG: null }, provenance: '用户填写', warnings: [] })
describe('常用食物详情按保存快照展示', () => {
  it('同时展示保存份量和每100g营养，明确区分0和缺失', () => {
    const wrapper = details(manual())
    expect(wrapper.get('[data-testid="personal-detail-total-energyKcal"]').text()).toBe('120 kcal')
    expect(wrapper.get('[data-testid="personal-detail-basis-energyKcal"]').text()).toBe('80 kcal')
    expect(wrapper.get('[data-testid="personal-detail-total-fatG"]').text()).toBe('0 g')
    expect(wrapper.get('[data-testid="personal-detail-total-carbsG"]').text()).toBe('待补充')
    wrapper.unmount()
  })
  it('未知重量只展示基准营养，饮品按mL计算，不套用每100g', async () => {
    const wrapper = details({ ...manual(), weightG: null })
    expect(wrapper.get('[data-testid="personal-detail-total-energyKcal"]').text()).toBe('待补充')
    const drink: FoodEntry = { ...manual(), weightG: null, nutrientsPer100g: { energyKcal: null, proteinG: null, fatG: null, carbsG: null }, volumeSnapshot: { amountMl: 250, nutrientsPer100ml: { energyKcal: 60, proteinG: null, fatG: 0, carbsG: 12 } } }
    await wrapper.setProps({ food: { ...wrapper.props('food'), entry: drink } })
    expect(wrapper.get('thead').text()).toContain('每100 mL')
    expect(wrapper.get('[data-testid="personal-detail-portion"]').text()).toBe('250 mL')
    expect(wrapper.get('[data-testid="personal-detail-total-energyKcal"]').text()).toBe('150 kcal')
    expect(wrapper.get('[data-testid="personal-detail-total-proteinG"]').text()).toBe('待补充')
    wrapper.unmount()
  })
  it('包装保留每份基准和kJ原标注，按已保存摄入份数换算', () => {
    const entry = createPackageEntry('包装豆乳', { basis: 'serving', energy: { value: 418.4, unit: 'kJ' }, proteinG: 2, fatG: 0, carbsG: null, servingSize: { amount: 250, unit: 'ml' }, netContent: { amount: 1000, unit: 'ml' } }, 'manual', 'user')
    entry.packageSnapshot!.consumedAmount = 2; entry.packageSnapshot!.consumedUnit = 'serving'
    const wrapper = details(entry)
    expect(wrapper.get('thead').text()).toContain('每份')
    expect(wrapper.get('[data-testid="personal-detail-basis-energyKcal"]').text()).toBe('100 kcal')
    expect(wrapper.get('[data-testid="personal-detail-total-energyKcal"]').text()).toBe('200 kcal')
    expect(wrapper.get('[data-testid="personal-detail-package"]').text()).toContain('418.4 kJ / 每份')
    wrapper.unmount()
  })
  it('AI详情沿用已选档位、区间及假设，查看不会切回默认或改写快照', () => {
    const entry = applyEstimateLevel(createEstimatedFoodEntry(recognitionEstimate('红豆粥', null, [], 'qwen', 'test-model', porridgeProfile)!, 200), 'high'), snapshot = JSON.stringify(entry)
    const wrapper = details(entry)
    expect(wrapper.get('[data-testid="personal-detail-total-energyKcal"]').text()).toBe('210 kcal')
    expect(wrapper.get('[data-testid="personal-detail-range"]').text()).toContain('180–240 kcal')
    expect(wrapper.get('[data-testid="personal-detail-warnings"]').text()).toContain('糖多且较浓稠')
    expect(wrapper.get('[data-testid="personal-detail-source"]').text()).toContain('qwen / test-model')
    expect(JSON.stringify(entry)).toBe(snapshot); wrapper.unmount()
  })
})
