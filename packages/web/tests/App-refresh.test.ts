// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/App.vue'
import { db, loadData } from '../src/lib/db'

// 只控制数据库读取的完成顺序，实际挂载应用，观察它传给页面的数据与存储错误提示。
vi.mock('../src/lib/db', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/db')>(), loadData: vi.fn() }))
vi.mock('../src/lib/api', () => ({ getHealth: vi.fn().mockResolvedValue({ status: 'ok', mode: 'mock', provider: 'mock', model: 'test' }) }))
vi.mock('../src/components/MealAssistant.vue', () => ({ default: { template: '<div />' } }))

type Data = Awaited<ReturnType<typeof loadData>>
const snapshot = (weightKg: number): Data => ({
  meals: [], weights: [{ date: '2026-10-29', weightKg, updatedAt: '2026-10-29T00:00:00.000Z' }],
  settings: { targetWeightKg: null }, estimatedFoods: [], water: [], exercises: [], dailyPlans: [], packagedFoods: [], libraryFoods: [],
})
function pendingRead() {
  let resolve!: (data: Data) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<Data>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
let wrapper: VueWrapper | undefined
beforeEach(() => { vi.mocked(loadData).mockReset(); vi.mocked(loadData).mockResolvedValue(snapshot(70)) })
afterEach(async () => { wrapper?.unmount(); wrapper = undefined; await db.delete(); vi.restoreAllMocks() })
async function open() {
  wrapper = mount(App, { global: { stubs: { DiaryView: { name: 'DiaryView', props: ['weights'], emits: ['changed'], template: '<div />' } } } })
  await flushPromises()
  return wrapper
}

describe('应用刷新完成顺序', () => {
  it('旧读取晚于新读取完成时，保留新体重而不倒退', async () => {
    const view = await open(), diary = view.findComponent({ name: 'DiaryView' })
    const older = pendingRead(), newer = pendingRead()
    vi.mocked(loadData).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    diary.vm.$emit('changed'); diary.vm.$emit('changed')
    newer.resolve(snapshot(68)); await flushPromises()
    expect(diary.props('weights')[0].weightKg).toBe(68)
    older.resolve(snapshot(69)); await flushPromises()
    expect(diary.props('weights')[0].weightKg).toBe(68)
  })

  it('新读取成功后，旧读取失败不显示已经过时的存储错误', async () => {
    const view = await open(), diary = view.findComponent({ name: 'DiaryView' })
    const older = pendingRead(), newer = pendingRead()
    vi.mocked(loadData).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    diary.vm.$emit('changed'); diary.vm.$emit('changed')
    newer.resolve(snapshot(68)); await flushPromises()
    older.reject(new Error('旧事务失败')); await flushPromises()
    expect(view.find('[role="alert"]').exists()).toBe(false)
    expect(diary.props('weights')[0].weightKg).toBe(68)
  })

  it('新读取失败后，旧读取成功不能清掉当前错误，后续重试可以恢复', async () => {
    const view = await open(), diary = view.findComponent({ name: 'DiaryView' })
    const older = pendingRead(), newer = pendingRead()
    vi.mocked(loadData).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    diary.vm.$emit('changed'); diary.vm.$emit('changed')
    newer.reject(new Error('新事务失败')); await flushPromises()
    expect(view.get('[role="alert"]').text()).toContain('无法读取浏览器存储')
    older.resolve(snapshot(69)); await flushPromises()
    expect(view.find('[role="alert"]').exists()).toBe(true)
    expect(diary.props('weights')[0].weightKg).toBe(70)
    vi.mocked(loadData).mockResolvedValueOnce(snapshot(67))
    diary.vm.$emit('changed'); await flushPromises()
    expect(view.find('[role="alert"]').exists()).toBe(false)
    expect(diary.props('weights')[0].weightKg).toBe(67)
  })
})
