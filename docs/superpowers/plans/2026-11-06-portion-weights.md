# Portion Weight Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修正个/盒/小包的重量换算，并使用当前模型估计缺少依据的单个/小包大小。

**Architecture:** 保留营养表数据，由模型单独估计每单位可食重量/容量，数量乘单份大小计算；AI估重作为明确标记的可编辑快照，不写入标签净含量或每份大小。共享契约支持包装量词，缺少估重时不强填通用100/200g。已有记录不批量回算。

**Tech Stack:** Vue、TypeScript、Zod、现有meal-assistant接口/安卓桥、Vitest、Playwright。

**Spec:** 用户要求重新核查个/盒单位，并以新增好丽友小包为例，要求使用AI估重。

## Global Constraints

- 好丽友内置条目有445g整包装净含量、无每份大小；不能把它当单独小包重量。
- 品牌不能确定规格，不把用户举例的20–30g硬编码为所有商品标准。
- 用户明确重量、标签明确计量优先；AI估重须说明依据、可修改，不改营养标签。
- 包装AI估重与原营养表必须同为g或mL才能算，不假定密度1。
- Mock/失败/信息不足不产生伪造重量；异步结果不能覆盖用户刚填写的数值或其它食品。

## Review Focus

- 同一大包装包含多个独立小包。
- 数量修改、切单位后的单份大小与总量保持一致。
- 混合食品名称误命中单个原料规则。
- AI估重来源、保存/恢复与后续手动修正。
- 页面关闭、切食品、手改期间的异步请求返回。

### Task 1: 共享换算与契约

- [x] 先加失败测试：未知个数不能100g；鸡蛋羹/鸡蛋面/香蕉牛奶不能被当原料；盒/包单位可解析；包装数量不能乘通用参考份量。
- [x] 扩展量词和可选portionEstimate、portionRequest；记录包装consumptionPortion并验证与总量一致。
- [x] 明确单个大小的来源优先级；无依据保留null，超限继续拒绝；修复单位切换沿用已有数量。
- [x] 专项测试通过。

### Task 2: AI估重入口与回归

- [x] 先测试选好丽友不再200g、使用模拟真实模型的34g小包估重、数量缩放与失败/过期结果保留原值。
- [x] 新增PortionEstimator/portion-estimation工具，调用已选模型；个数和包装编辑可触发AI估重，缺资料的新增包装自动尝试，展示来源。
- [x] 完整单元/接口、类型与构建，Chrome手机/桌面、Edge对应回归与截图核对。
- [x] 代码复核并更新使用文档；说明未重新计算旧记录及真实模型/真机验证范围。
