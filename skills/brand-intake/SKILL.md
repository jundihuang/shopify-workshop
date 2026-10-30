---
name: brand-intake
description: >-
  把学员填写的品牌资料与可选 Logo/色值整理为 brand-brief.json，供骨架 Theme 填充与 GEO 文案约束。
  超时可套用预置 Demo Brief。
---

# brand-intake

## 何时使用

渠道发布之后、骨架 Theme 之前；或学员更新品牌话术时。

## 最少必填

```text
品牌名称、品牌介绍、目标用户、核心卖点、品牌调性、主色
Logo 可选；语言/币种默认 en-US / USD
```

## 输出

符合 `templates/brand-brief.schema.json` 的 `brand-brief.json`，含：

- audience / positioning / tone / visual / selling_points / trust_signals
- pages.home|collection|product 的 section **意图**（供骨架填充，不是从零设计站）

## 缺失处理

- 列出 missing[]
- 提供「用默认值继续」或「加载 Demo Brief（Aurora Skincare）」
- 未填写的 locale / currency 使用 `en-US` / `USD`，不记入 missing[]

## 运行时

实现位于 `runtime/brand-intake/`，入口为 `scripts/brand-intake.sh`。要求 Node.js 20+，无 npm 依赖。这一步只写本地 JSON，不调用 Shopify Admin，不改 Theme，不改商品，不读取 `accessUrl`。

### 1. plan

```bash
./scripts/brand-intake.sh plan \
  --group-id A \
  --answers templates/brand-intake.answers.sample.json

# 没有答案文件时，先看 Demo Brief 会变成什么样：
./scripts/brand-intake.sh plan --group-id A --demo
```

写入：

```text
.workshop/<group_id>/brand-brief.plan.json
```

`plan` 对照 `templates/brand-brief.schema.json` 校验并规范化答案，stdout / plan 里给出：

- `missing[]`：仍缺的学员字段（确认后会用默认值补齐，并原样留在 brief 的 `missing` 里）
- `risk_flags` 与 `tone.avoid`：夸大 / 医疗风险表述
- `participant_confirm_copy`：`「锁定 Brand Brief，供骨架 Theme 填充与 GEO 文案约束使用（不写 Shopify）」`
- `continuations`：`用默认值继续`，或 `加载 Demo Brief（Aurora Skincare）`

`plan` 不写 `brand-brief.json`，也不改 `workshop-state.yaml`。

### 2. apply（人工确认后）

人工确认留在 CLI 外面。`apply` 必须带 `--confirm`，`--dry-run` 同样要带。

```bash
# 用学员答案锁定（缺项按 plan 里的默认值补齐）
./scripts/brand-intake.sh apply \
  --group-id A \
  --confirm \
  --answers templates/brand-intake.answers.sample.json

# 超时或没有答案：加载预置 Aurora Skincare，不访问网络
./scripts/brand-intake.sh apply --group-id A --confirm --demo --dry-run
```

写入：

```text
.workshop/<group_id>/brand-brief.json
.workshop/<group_id>/workshop-state.yaml
```

- 学员答案（含「用默认值继续」）→ `brand.status=done`，`brand.brief_file=brand-brief.json`
- `--demo` → `brand.status=fallback_demo`，内容来自 `templates/brand-brief.demo.aurora-skincare.json`
- `--demo` 不需要答案文件；若同时传了 `--answers`，以 Demo Brief 为准
- 成功时保留 connection / products / theme / geo 等已有段落，只更新 `brand`

`--dry-run` 是离线演练开关。本运行时两条路径都不调用 Shopify。

### 风险表述

学员文案里的医疗承诺（如 cure、clinically proven、治愈）和夸大承诺（如 miracle、guaranteed、overnight、100% effective、world's best）会追加到 `tone.avoid`，原文仍留在对应字段里，供 Theme 填充和 GEO 文案避开。

### 安全边界

- 不连接 Shopify，不写商品，不 push / publish Theme
- 不读、不写 `accessUrl`、token、店面密码；答案里出现这些字段会直接拒绝
- Preview Store 仍是 Workshop 唯一店路径；本步不创建店，也不改挂 Dev Store
- 产物写入前做敏感字段检查；`.workshop/` 维持 gitignore

## 验收

- JSON 可被 `shopify-theme-builder` 与 `shopify-geo-optimizer` 直接消费
- 识别夸大/医疗风险表述并写入 `tone.avoid`
- `npm test` 覆盖 schema、missing、Demo Brief、风险表述、无 `--confirm` 拒绝，以及 `--demo --dry-run` 不需要答案文件
