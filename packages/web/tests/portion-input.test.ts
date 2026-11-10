// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { calculateNutrients, foodEntrySchema, type FoodEntry } from '@shike/shared'
import ManualFoodSheet from '../src/components/ManualFoodSheet.vue'
import PortionAmountInput from '../src/components/PortionAmountInput.vue'
import PortionEstimator from '../src/components/PortionEstimator.vue'
it('单份AI估重不把明确清空的数量补成1，换量词也不沿用旧数量', () => {
  const portion = { unit: '个' as const, quantity: null, amountPerUnit: 80, basis: 'g' as const, assumption: '用户清空数量' };
  const view = mount(PortionAmountInput, { props: { name: '包子', amount: null, basis: 'g', portion, prefix: 'test', amountTestId: 'amount' } });
  view.findComponent(PortionEstimator).vm.$emit('estimated', { ...portion, quantity: 1, amountPerUnit: 34 });
  expect(view.emitted('change')![0]![0]).toMatchObject({ amount: null, portion: { quantity: null, amountPerUnit: 34 } });
  view.findComponent(PortionEstimator).vm.$emit('estimated', { ...portion, unit: '盒', quantity: 1, amountPerUnit: 200 });
  expect(view.emitted('change')![1]![0]).toMatchObject({ amount: null, portion: { unit: '盒', quantity: null } });
  view.unmount();
});
it('自动份量切回相同量词时保留原有数量和单个大小，不能把两只总重当单只', async () => {
  const portion = { unit: '个' as const, quantity: 2, amountPerUnit: 80, basis: 'g' as const, assumption: '常见份量估算：2个包子' };
  const view = mount(PortionAmountInput, { props: { name: '肉包', amount: 160, basis: 'g', portion, prefix: 'test', amountTestId: 'amount' } });
  await view.get('[data-testid="test-unit"]').setValue('个');
  expect(view.emitted('change')![0]![0]).toMatchObject({ amount: 160, portion: { quantity: 2, amountPerUnit: 80 } });
  await view.setProps({ portion: (view.emitted('change')![0]![0] as { portion: typeof portion }).portion });
  expect(view.get('[data-testid="test-summary"]').text()).toContain('160 g');
  view.unmount();
});
it('把自动参考200g切换成包时，不能把参考总量当成已知每包200g', async () => {
  const view = mount(PortionAmountInput, { props: { name: '好丽友', amount: 200, basis: 'g', portion: { unit: '份', quantity: 1, amountPerUnit: 200, basis: 'g', assumption: '常见份量估算：未称重的通用200g' }, prefix: 'test', amountTestId: 'amount' } });
  await view.get('[data-testid="test-unit"]').setValue('包');
  expect(view.emitted('change')![0]![0]).toMatchObject({ amount: null, portion: { unit: '包', amountPerUnit: null } }); view.unmount();
});
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined })
function form() {
  wrapper = mount(ManualFoodSheet, { props: { personalFoods: [] }, global: { stubs: { AppSheet: { template: '<section><slot /><slot name="footer" /></section>' } } } })
  return wrapper
}
it('一个包子估80g，可修改数量和单个大小，保存完整快照', async () => {
  const view = form(); await view.get('[data-testid="manual-food-name"]').setValue('菜包')
  await view.get('[data-testid="manual-food-unit"]').setValue('个')
  expect(view.get('[data-testid="manual-food-summary"]').text()).toContain('80 g')
  await view.get('[data-testid="manual-food-quantity"]').setValue('2')
  await view.get('[data-testid="manual-food-per-unit"]').setValue('95')
  expect(view.get('[data-testid="manual-food-summary"]').text()).toContain('190 g')
  await view.get('form').trigger('submit')
  const entry = view.emitted('add')![0]![0] as FoodEntry
  expect(entry.weightG).toBe(190); expect(entry.portionSnapshot).toMatchObject({ unit: '个', quantity: 2, amountPerUnit: 95, basis: 'g' })
  expect(foodEntrySchema.safeParse(entry).success).toBe(true)
})
it('切回g保留总重量，换名称时不沿用旧食物的单个大小假设', async () => {
  const view = form(); await view.get('[data-testid="manual-food-name"]').setValue('肉包')
  await view.get('[data-testid="manual-food-unit"]').setValue('个'); await view.get('[data-testid="manual-food-quantity"]').setValue('2')
  await view.get('[data-testid="manual-food-unit"]').setValue('g'); expect(view.get('[data-testid="manual-food-weight"]').element).toHaveProperty('value', '160')
  await view.get('[data-testid="manual-food-unit"]').setValue('个'); await view.get('[data-testid="manual-food-name"]').setValue('香蕉')
  expect(view.get('[data-testid="manual-food-unit"]').element).toHaveProperty('value', 'g')
})
it('已有重量切换单位时保留总量，不用通用80g覆盖明确填写的88.88g', async () => {
  const view = form(); await view.get('[data-testid="manual-food-name"]').setValue('肉包')
  await view.get('[data-testid="manual-food-weight"]').setValue('88.88'); await view.get('[data-testid="manual-food-unit"]').setValue('个')
  expect(view.get('[data-testid="manual-food-per-unit"]').element).toHaveProperty('value', '88.88')
  await view.get('form').trigger('submit'); expect((view.emitted('add')![0]![0] as FoodEntry).weightG).toBe(88.88)
})
it('饮品按杯换算mL，保留独立每100mL营养，未知数量不假设为一杯', async () => {
  const view = form(); await view.get('[data-testid="manual-food-name"]').setValue('自制饮品')
  await view.get('[data-testid="manual-food-unit"]').setValue('ml'); await view.get('[data-testid="manual-food-energyKcal"]').setValue('60')
  await view.get('[data-testid="manual-food-unit"]').setValue('杯'); await view.get('form').trigger('submit')
  const entry = view.emitted('add')![0]![0] as FoodEntry
  expect(entry.volumeSnapshot!.amountMl).toBe(250); expect(entry.weightG).toBeNull(); expect(calculateNutrients(entry).energyKcal).toBe(150)
})
it('单位数量留空可以保存为未知重量，营养库数据不因此变成零', async () => {
  const view = form(); await view.get('[data-testid="manual-food-name"]').setValue('肉包'); await view.get('[data-testid="manual-food-unit"]').setValue('个')
  await view.get('[data-testid="manual-food-quantity"]').setValue(''); await view.get('form').trigger('submit')
  const entry = view.emitted('add')![0]![0] as FoodEntry
  expect(entry.weightG).toBeNull(); expect(entry.portionSnapshot!.quantity).toBeNull(); expect(calculateNutrients(entry).energyKcal).toBeNull()
})
