/**
 * 返回栈只表示应用的界面层级，WebView 文档历史无法表达“餐食→添加→选库”。
 * 后注册的有效层优先；忙碌层即使拒绝关闭，也消费返回，不让事件落到父层。
 * pending 覆盖异步关闭及 settle（Vue nextTick），防止连续手势在卸载完成前穿透。
 * use-back-layer.ts 管登记和 KeepAlive，use-android-back.ts 管原生事件，App.vue 管首页兜底。
 * 回归：back-navigation.test.ts、use-back-layer.test.ts、tests/e2e/android-back.spec.ts。
 * 浏览器桥模拟只能验证契约；键盘先收起、边缘手势、后台恢复仍需安卓真机检查。
 */
export class BackLayers {
  private layers: Array<{ run: () => void | Promise<void>; active: boolean }> = []
  private pending = false

  constructor(private readonly settle: () => Promise<unknown> = () => Promise.resolve()) {}

  get hasActive() { return this.layers.some(layer => layer.active) }

  add(run: () => void | Promise<void>) {
    const layer = { run, active: true }
    this.layers.push(layer)
    return {
      setActive: (active: boolean) => { layer.active = active },
      remove: () => { this.layers = this.layers.filter(item => item !== layer) },
    }
  }

  async back(fallback: () => void | Promise<void>) {
    // 同一次异步关闭期间的重复回调不能穿透到父弹窗或首页。
    if (this.pending) return
    this.pending = true
    try {
      const layer = [...this.layers].reverse().find(item => item.active)
      // 即使保存中不允许关闭，当前层仍消费返回事件，绝不向下穿透。
      await (layer ? layer.run() : fallback())
    } finally {
      try { await this.settle() } finally { this.pending = false }
    }
  }
}
