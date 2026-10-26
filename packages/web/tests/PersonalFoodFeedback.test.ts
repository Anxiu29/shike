// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFoodEntry, findFood, type LibraryFood } from '@shike/shared'
import PersonalFoodLibrary from '../src/components/PersonalFoodLibrary.vue'
import { db } from '../src/lib/db'
vi.mock('../src/lib/db', () => ({ db: { transaction: vi.fn(), libraryFoods: {} } }))
afterEach(() => vi.clearAllMocks())
const food = (): LibraryFood => ({ id: 'food', choiceId: 'saved:food', origin: 'manual', entry: createFoodEntry(findFood('米饭')!, 150), favorite: false, createdAt: '2026-10-26T01:00:00Z', updatedAt: '2026-10-26T01:00:00Z' })
const open = () => mount(PersonalFoodLibrary, { props: { foods: [food()] }, global: { stubs: { AppSheet: { template: '<section><slot/><slot name="footer"/></section>' } } } })
describe('个人常用库操作反馈', () => {
  it('慢存储时显示进行中并阻止重复点击，成功后立即显示星标和提示', async () => {
    let resolve!: (value: boolean) => void
    vi.mocked(db.transaction).mockReturnValueOnce(new Promise<boolean>(done => { resolve = done }) as never)
    const wrapper = open(), button = wrapper.get('[data-testid="personal-favorite-food"]')
    await button.trigger('click')
    expect(button.attributes('aria-busy')).toBe('true')
    expect(button.attributes()).toHaveProperty('disabled')
    await button.trigger('click'); expect(db.transaction).toHaveBeenCalledTimes(1)
    resolve(true); await flushPromises()
    expect(button.attributes('aria-pressed')).toBe('true')
    expect(button.attributes('aria-busy')).toBe('false')
    expect(wrapper.emitted('notify')![0]![0]).toContain('设为星标')
    wrapper.unmount()
  })
  it('存储失败保留原星标状态，显示失败并允许重试', async () => {
    vi.mocked(db.transaction).mockRejectedValueOnce(new Error('模拟存储失败'))
    const wrapper = open(), button = wrapper.get('[data-testid="personal-favorite-food"]')
    await button.trigger('click'); await flushPromises()
    expect(button.attributes('aria-pressed')).toBe('false')
    expect(button.attributes()).not.toHaveProperty('disabled')
    expect(wrapper.get('[role="alert"]').text()).toContain('星标保存失败')
    expect(wrapper.emitted('notify')![0]![0]).toContain('失败')
    wrapper.unmount()
  })
})
