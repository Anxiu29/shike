// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { backLayers, useBackLayer } from '../src/lib/use-back-layer'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; expect(backLayers.hasActive).toBe(false) })

it('父组件先登记，子组件后登记；同次渲染关闭子层后不会误关父层', async () => {
  const childOpen = ref(true), parentClose = vi.fn(), fallback = vi.fn()
  const Child = defineComponent({ setup() { useBackLayer(() => true, () => { childOpen.value = false }); return () => h('div', 'child') } })
  const Parent = defineComponent({ setup() { useBackLayer(() => true, parentClose); return () => childOpen.value ? h(Child) : h('div') } })
  wrapper = mount(Parent)
  await backLayers.back(fallback); expect(parentClose).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled()
  await backLayers.back(fallback); expect(parentClose).toHaveBeenCalledTimes(1)
})

it('动态打开的同级弹窗按打开顺序返回，关闭后解除拦截', async () => {
  const a = ref(false), b = ref(false), calls: string[] = []
  const Layer = defineComponent({ props: { open: Boolean, id: String }, setup(props) { useBackLayer(() => props.open, () => { calls.push(props.id!); if (props.id === 'a') a.value = false; else b.value = false }); return () => h('div') } })
  wrapper = mount(defineComponent({ setup: () => () => [h(Layer, { open: a.value, id: 'a' }), h(Layer, { open: b.value, id: 'b' })] }))
  b.value = true; await nextTick(); a.value = true; await nextTick()
  await backLayers.back(vi.fn()); await backLayers.back(vi.fn()); expect(calls).toEqual(['a', 'b'])
  expect(backLayers.hasActive).toBe(false)
})

it('KeepAlive切走后不拦截，重新进入后可返回，卸载清理登记', async () => {
  const visible = ref(true), close = vi.fn(), fallback = vi.fn()
  const Page = defineComponent({ setup() { useBackLayer(() => true, close); return () => h('div') } })
  wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, () => visible.value ? h(Page) : null) }))
  visible.value = false; await nextTick(); await backLayers.back(fallback); expect(fallback).toHaveBeenCalledTimes(1)
  visible.value = true; await nextTick(); await backLayers.back(fallback); expect(close).toHaveBeenCalledTimes(1)
})
