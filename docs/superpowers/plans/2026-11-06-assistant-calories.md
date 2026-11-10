# AI 对话热量计算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** AI 回复显示逐项热量、合计及依据，支持不记餐的热量查询，并让追问使用最新本地计算。

**Architecture:** 复用本地 assistantEntry/calculateNutrients；模型继续只负责解析食物。新增 estimate 意图用于仅估算，聊天展示不可变热量快照；发送时带当前草稿和最近一次估算/保存结果的精简营养上下文。

**Tech Stack:** Vue 3、TypeScript、Zod、Vitest、Playwright；沿用现有工作区。

**Spec:** 本聊天已提出的改法及用户“开始改”的执行授权。

## Global Constraints

- 热量缺失保留 null，已知部分不得冒充整餐；明确 0 保留。
- 仅查询不创建或替换草稿，点击确认保存才写记录。
- 来源和参考份量明确展示；不新增模型调用或依赖。
- 修改数量、删除、新对话、清空、详细编辑不发送过期草稿营养。
- 网页服务端与安卓沿用同一共享契约，现有毫升换算边界保留。

## Review Focus

- 全部未知/部分未知/明确零热量。
- 查询期间已有草稿与估算上下文区分。
- 数量手改或删除后追问使用最新值；旧聊天快照保持原值。
- 清空与新对话后不残留旧营养；保存后可追问刚保存的一餐。
- 多项长名称在手机显示不溢出，接口拒绝无界上下文。

### Task 1: 共享契约与本地快照

**Files:** shared/src/meal-assistant.ts、web/src/lib/meal-assistant.ts 及对应测试。

**Interfaces:** assistantNutrition(entries, scope, date, mealType, mode) 返回 AssistantNutrition；assistantEnergyLabel(snapshot) 返回已知/缺失合计文案。

- [x] 先写测试：estimate 有食物，question/clear 无食物；营养上下文通过请求和平台适配，非法数值/超长数组拒绝。
- [x] 运行专项 Vitest，确认新断言失败。
- [x] 新增有界 nutrition 上下文、estimate 意图和提示词；本地生成逐项热量、来源、假设与缺失计数。
- [x] 测试部分缺失、全缺失、0、包装 mL 与快照独立性并通过专项测试。

### Task 2: 对话与草稿展示

**Files:** web/src/components/MealAssistant.vue、web/src/components/AssistantNutrition.vue、web/src/style.css；tests/e2e/meal-assistant.spec.ts。

- [x] 添加失败场景：聊天展示逐项和合计；查询不改草稿；手改/删除后的请求更新营养；保存、新对话清理正确。
- [x] 展示本地热量快照，草稿逐项热量随数量变化，发送最新营养上下文；estimate 只展示结果。
- [x] 运行全部单元测试、类型检查、生产构建及助手专项 Chrome 手机/桌面、Edge 回归。
- [x] 查看手机截图并更新 docs/meal-assistant.md；核查差异后报告验证范围。
