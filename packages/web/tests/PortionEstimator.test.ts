// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PortionEstimator from '../src/components/PortionEstimator.vue'
const { estimate } = vi.hoisted(() => ({ estimate: vi.fn() }))
vi.mock('../src/lib/portion-estimation', () => ({ estimatePortion: estimate }))
const result = { unit: '包', quantity: 1, amountPerUnit: 34, basis: 'g', assumption: 'AI估重，单独小包' }
describe('AI估重交互', () => {
  it('新增缺少单份大小的包装自动估重，用户改值或关闭后不覆盖新输入', async () => {
    let resolve!: (value: typeof result) => void
    estimate.mockImplementation(() => new Promise(done => { resolve = done }))
    const delivered = vi.fn()
    const view = mount(PortionEstimator, { props: { name: '好丽友派', unit: '包', auto: true, revision: 'empty', onEstimated: delivered } })
    await view.vm.$nextTick()
    expect(view.get('[data-testid="portion-estimate"]').text()).toContain('正在估重')
    await view.setProps({ revision: '用户填写了23g' }); resolve(result); await flushPromises()
    expect(view.emitted('estimated')).toBeUndefined()
    await view.get('[data-testid="portion-estimate"]').trigger('click'); resolve(result); await flushPromises()
    expect(view.emitted('estimated')![0]![0]).toMatchObject({ amountPerUnit: 34 })
    await view.get('[data-testid="portion-estimate"]').trigger('click'); view.unmount(); resolve(result); await flushPromises()
    expect(delivered).toHaveBeenCalledTimes(1)
  })
  it('失败提供可读提示并允许重试，不输出默认重量', async () => {
    estimate.mockRejectedValueOnce(new Error('规格不明，请手动填写')).mockResolvedValueOnce(result)
    const view = mount(PortionEstimator, { props: { name: '好丽友派', unit: '包', revision: 'empty' } })
    await view.get('[data-testid="portion-estimate"]').trigger('click'); await flushPromises()
    expect(view.get('[data-testid="portion-estimate-error"]').text()).toContain('规格不明'); expect(view.emitted('estimated')).toBeUndefined()
    await view.get('[data-testid="portion-estimate"]').trigger('click'); await flushPromises(); expect(view.emitted('estimated')).toHaveLength(1); view.unmount()
  })
})
