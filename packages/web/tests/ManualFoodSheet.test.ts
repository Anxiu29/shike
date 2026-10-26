// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { calculateNutrients, type FoodEntry } from '@shike/shared'
import ManualFoodSheet from '../src/components/ManualFoodSheet.vue'

function form() { return mount(ManualFoodSheet, { props: { personalFoods: [] }, global: { stubs: { AppSheet: { template: '<section><slot /><slot name="footer" /></section>' } } } }) }
describe('手动食物输入弹窗', () => {
  it('常用库保存失败保留输入并允许重试，保存期间避免重复或取消', async () => {
    const wrapper = form(); await wrapper.setProps({ purpose: 'library' })
    await wrapper.get('[data-testid="manual-food-name"]').setValue('自制早餐')
    await wrapper.get('[data-testid="manual-food-weight"]').setValue('120')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[data-testid="confirm-manual-food"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="cancel-manual-food"]').attributes('disabled')).toBeDefined()
    wrapper.vm.saveFailed('存储失败，请重试')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="manual-food-error"]').text()).toContain('存储失败')
    expect(wrapper.get('[data-testid="manual-food-name"]').element).toHaveProperty('value', '自制早餐')
    expect(wrapper.get('[data-testid="manual-food-weight"]').element).toHaveProperty('value', '120')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('add')).toHaveLength(2)
    wrapper.unmount()
  })
  it('饮品mL不使用同名每100g资料，换单位清除旧份量与数值', async () => {
    const wrapper = form(); await wrapper.get('[data-testid="manual-food-name"]').setValue('牛奶'); await wrapper.get('[data-testid="manual-food-weight"]').setValue('200');
    await wrapper.get('[data-testid="manual-food-unit"]').setValue('ml'); expect(wrapper.get('[data-testid="manual-food-weight"]').element).toHaveProperty('value', '');
    await wrapper.get('[data-testid="manual-food-weight"]').setValue('250'); expect(wrapper.get('[data-testid="manual-food-preview"]').text()).toContain('热量待补充');
    await wrapper.get('[data-testid="manual-food-energyKcal"]').setValue('60'); await wrapper.get('form').trigger('submit');
    const entry = wrapper.emitted('add')![0]![0] as FoodEntry; expect(entry.weightG).toBeNull(); expect(calculateNutrients(entry).energyKcal).toBe(150); expect(entry.referenceId).toBeUndefined(); wrapper.unmount();
  })
  it('确认前只持有草稿；名称必填，重量不默认100g', async () => {
    const wrapper = form(); expect(wrapper.emitted('add')).toBeUndefined()
    await wrapper.get('form').trigger('submit'); expect(wrapper.get('[data-testid="manual-food-error"]').text()).toContain('食物名称')
    await wrapper.get('[data-testid="manual-food-name"]').setValue('米饭'); await wrapper.get('form').trigger('submit')
    const entry = wrapper.emitted('add')![0]![0] as FoodEntry
    expect(entry.kind).toBe('database'); expect(entry.weightG).toBeNull(); expect(calculateNutrients(entry).energyKcal).toBeNull()
    await wrapper.get('form').trigger('submit'); expect(wrapper.emitted('add')).toHaveLength(1)
    wrapper.unmount()
  })
  it('已知食物匹配本地库；输入最多两位小数且按填写重量换算', async () => {
    const wrapper = form(); await wrapper.get('[data-testid="manual-food-name"]').setValue('米饭'); await wrapper.get('[data-testid="manual-food-weight"]').setValue('150.256')
    expect(wrapper.get('[data-testid="manual-food-weight"]').element).toHaveProperty('value', '150.26')
    await wrapper.get('form').trigger('submit'); const entry = wrapper.emitted('add')![0]![0] as FoodEntry
    expect(entry.weightG).toBe(150.26); expect(calculateNutrients(entry).energyKcal).toBeCloseTo(195.338)
    wrapper.unmount()
  })
  it('确定营养覆盖自动匹配，其他空白保持未知；取消不提交', async () => {
    const wrapper = form(); await wrapper.get('[data-testid="manual-food-name"]').setValue('米饭'); await wrapper.get('[data-testid="manual-food-weight"]').setValue('200'); await wrapper.get('[data-testid="manual-food-energyKcal"]').setValue('80')
    await wrapper.get('form').trigger('submit'); const entry = wrapper.emitted('add')![0]![0] as FoodEntry
    expect(entry.kind).toBe('manual'); expect(entry.nutrientsPer100g.proteinG).toBeNull(); expect(calculateNutrients(entry).energyKcal).toBe(160)
    wrapper.unmount(); const cancelled = form(); await cancelled.get('[data-testid="cancel-manual-food"]').trigger('click'); expect(cancelled.emitted('close')).toHaveLength(1); expect(cancelled.emitted('add')).toBeUndefined(); cancelled.unmount()
  })
  it('未知名称保留缺失营养，非法重量和营养不允许添加', async () => {
    const wrapper = form(); await wrapper.get('[data-testid="manual-food-name"]').setValue('我的未收录食物'); await wrapper.get('[data-testid="manual-food-weight"]').setValue('-1'); await wrapper.get('form').trigger('submit'); expect(wrapper.emitted('add')).toBeUndefined()
    await wrapper.get('[data-testid="manual-food-weight"]').setValue('100'); await wrapper.get('[data-testid="manual-food-energyKcal"]').setValue('1001'); await wrapper.get('form').trigger('submit'); expect(wrapper.emitted('add')).toBeUndefined()
    await wrapper.get('[data-testid="manual-food-energyKcal"]').setValue(''); await wrapper.get('form').trigger('submit'); const entry = wrapper.emitted('add')![0]![0] as FoodEntry
    expect(entry.kind).toBe('unknown'); expect(calculateNutrients(entry).energyKcal).toBeNull(); wrapper.unmount()
  })
})
