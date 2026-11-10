// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { emptyPackageLabel, type PackageSnapshot } from '@shike/shared'
import PackageLabelEditor from '../src/components/PackageLabelEditor.vue'

const snapshot: PackageSnapshot = {
  label: { ...emptyPackageLabel(), basis: '100g', energy: { value: 400, unit: 'kcal' } },
  consumedAmount: 68, consumedUnit: 'g', provider: 'manual', model: '测试', manuallyEdited: false,
  consumptionPortion: { quantity: 2, unit: '包', amountPerUnit: 34, basis: 'g', assumption: 'AI估重·测试模型，需核对' },
}
function open() { return mount(PackageLabelEditor, { props: { snapshot, index: 0 }, global: { stubs: { PortionAmountInput: true, PortionEstimator: true } } }) }
describe('包装营养修正与单包估重来源', () => {
  it('修正能量和蛋白质保留已吃数量、单包大小及依据', async () => {
    const form = open()
    for (const field of ['energy', 'proteinG']) {
      await form.get(`[data-testid="package-${field}-0"]`).setValue('10')
      const changed = form.emitted('change')!.at(-1)![0] as PackageSnapshot
      expect(changed.consumptionPortion).toEqual(snapshot.consumptionPortion)
      expect(changed.consumedAmount).toBe(68); expect(changed.manuallyEdited).toBe(true)
    }
    form.unmount()
  })
  it('直接改实际总重时移除已不适用的单包换算', async () => {
    const form = open()
    await form.get('[data-testid="package-amount-0"]').setValue('80')
    const changed = form.emitted('change')!.at(-1)![0] as PackageSnapshot
    expect(changed.consumedAmount).toBe(80); expect(changed.consumptionPortion).toBeUndefined()
    form.unmount()
  })
})
