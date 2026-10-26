/**
 * 三份数据逐字段合并：draft 是输入，baseline 是上次收到的保存值，latest 是外部新值。
 * 例：本页只改身高，体重页将目标65改64；身高草稿保留，未改的目标接收64。
 * 同一字段双方都修改时保留本地草稿，须再次明确保存才覆盖；这是单设备表单规则。
 * GoalsView.changedSettings 只提交变化字段，db.saveSettings 在事务内按最新值合并，
 * 避免保存身高时把另一页的新目标覆盖回65。保存期间继续输入也不能被标成已保存。
 * 回归：profile-sync.test.ts 与 tests/e2e/profile-sync.spec.ts。
 */
export function rebaseDraft<T extends object>(draft: T, baseline: T, latest: T): T {
  const next = { ...latest }
  for (const key of Object.keys(latest) as Array<keyof T>) {
    if (!Object.is(draft[key], baseline[key])) next[key] = draft[key]
  }
  return next
}
