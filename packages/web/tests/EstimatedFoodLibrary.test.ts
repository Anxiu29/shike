// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { EstimatedFood } from '@shike/shared'
import EstimatedFoodLibrary from '../src/components/EstimatedFoodLibrary.vue'
const foods: EstimatedFood[] = Array.from({ length: 35 }, (_, index) => ({ id: `food-${index}`, name: `测试估算${index}`, model: 'test-model', provider: 'qwen', createdAt: '2026-10-26T00:00:00Z', updatedAt: '2026-10-26T00:00:00Z', nutrientsPer100g: { energyKcal: index === 0 ? null : 100, proteinG: null, fatG: 0, carbsG: null }, provenance: '测试', assumptions: ['用油待核对'] }))
describe('设置估算库按需管理', () => {
  it('主页只展示摘要，打开后分页和搜索；删除事件携带原条目', async () => {
    const wrapper = mount(EstimatedFoodLibrary, { props: { foods }, global: { stubs: { AppSheet: { props: ['open'], template: '<section v-if="open"><slot/></section>' } } } })
    expect(wrapper.findAll('[data-testid^="estimated-food-"]')).toHaveLength(1) // 只有数量徽章
    await wrapper.get('[data-testid="manage-estimates"]').trigger('click')
    expect(wrapper.findAll('.estimate-library-item')).toHaveLength(10)
    expect(wrapper.get('[data-testid="estimated-food-0"]').text()).toContain('热量待补充')
    await wrapper.get('[data-testid="estimate-load-more"]').trigger('click'); expect(wrapper.findAll('.estimate-library-item')).toHaveLength(20)
    await wrapper.get('[data-testid="estimate-search"]').setValue('估算34'); expect(wrapper.findAll('.estimate-library-item')).toHaveLength(1)
    await wrapper.get('[data-testid="delete-estimated-food"]').trigger('click'); expect(wrapper.emitted('remove')?.[0]).toEqual([foods[34]])
    await wrapper.get('[data-testid="estimate-search"]').setValue('找不到'); expect(wrapper.text()).toContain('没有找到匹配')
    wrapper.unmount()
  })
})
