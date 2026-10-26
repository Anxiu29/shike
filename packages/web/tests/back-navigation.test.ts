import { describe, expect, it, vi } from 'vitest'
import { BackLayers } from '../src/lib/back-navigation'

describe('安卓返回层级', () => {
  it('只处理最上层，关闭与移除后才返回父层，最后使用页面导航', async () => {
    const stack = new BackLayers(), parent = vi.fn(), fallback = vi.fn()
    const first = stack.add(parent)
    const child = stack.add(() => child.remove())
    await stack.back(fallback)
    expect(parent).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled()
    await stack.back(fallback); expect(parent).toHaveBeenCalledTimes(1)
    first.remove(); await stack.back(fallback); expect(fallback).toHaveBeenCalledTimes(1)
    expect(stack.hasActive).toBe(false)
  })
  it('忙碌表单不允许关闭时也消费返回，不触发父层或退出', async () => {
    const stack = new BackLayers(), fallback = vi.fn(), parent = vi.fn()
    stack.add(parent); stack.add(() => {})
    await stack.back(fallback)
    expect(parent).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled()
  })
  it('快速重复回调不能穿透正在关闭的层，Vue渲染完成后才接受下一次', async () => {
    let settle!: () => void
    const stack = new BackLayers(() => new Promise<void>(resolve => { settle = resolve }))
    const fallback = vi.fn(), child = stack.add(() => child.remove())
    const pending = stack.back(fallback)
    await Promise.resolve(); await stack.back(fallback)
    expect(fallback).not.toHaveBeenCalled()
    settle(); await pending
  })
  it('KeepAlive失活层不拦截，恢复后保持父子顺序', async () => {
    const stack = new BackLayers(), parent = vi.fn(), child = vi.fn(), fallback = vi.fn()
    const first = stack.add(parent), second = stack.add(child)
    first.setActive(false); second.setActive(false)
    await stack.back(fallback); expect(fallback).toHaveBeenCalledTimes(1)
    second.setActive(true); first.setActive(true)
    await stack.back(fallback); expect(child).toHaveBeenCalledTimes(1); expect(parent).not.toHaveBeenCalled()
  })
  it('处理异常后释放锁，下次返回仍可使用', async () => {
    const stack = new BackLayers(), fallback = vi.fn()
    const layer = stack.add(() => { throw Error('close failed') })
    await expect(stack.back(fallback)).rejects.toThrow('close failed')
    layer.remove(); await stack.back(fallback); expect(fallback).toHaveBeenCalledTimes(1)
  })
})
