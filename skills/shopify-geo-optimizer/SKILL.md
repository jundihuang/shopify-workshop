---
name: shopify-geo-optimizer
description: >-
  根据 shopify-geo-eval-workshop 的 scorecard 和 brand brief 生成商品 Before/After 文案；
  现场默认「批准全部 P0」，可选精审 1–2 个商品。确认后写回 Admin，并调用 workshop geo-eval 再评分。
  不使用完整版 shopify-geo-eval。
---

# shopify-geo-optimizer

## 隔离声明（必读）

本 skill 只做 Workshop 现场的 P0 文案建议和写回。

- 诊断只来自 `shopify-geo-eval-workshop` 写出的 `geo.before.json`
- 文案约束只来自 `brand-brief.json`（品类、卖点、场景、`tone.avoid`）
- 再评分只调用同仓库的 `shopify-geo-eval-workshop`（`--phase after`）
- 不拷贝、不引用完整版诊断的方法论、规则、评分引擎、客户 deck 或提示词
- 学员文档不解释完整版怎么打分

## 何时使用

Workshop GEO Before 已完成，需要一批 P0 改写并演示再评分。

## 原则

```text
诊断来自 shopify-geo-eval-workshop
建议约束来自 brand brief
写回前必须确认（批量 P0 = 一次确认）
写回后调用 shopify-geo-eval-workshop 再评分
```

## 现场 UX（强制）

1. 主按钮：**批准全部 P0**（`--approve-all-p0`）
2. 精审：最多 1–2 个商品（`--deep-review`）。可以改 proposal 里的 `after`，或 `--ignore handle:field`
3. P1 默认折叠；时间不够跳过。批 P0 不会写 P1
4. **禁止**引导学员逐条审 8×N 条

## P0 字段

```text
title, description, meta_title, meta_description, key_attributes
```

约束：带上品类、卖点和场景；不夸大；无医疗保证；`tone.avoid` 里的说法不能出现在 after 文案里。meta title 约 60 字符，meta description 约 150 字符。

## 运行时

实现：[runtime/shopify-geo-optimizer](../../runtime/shopify-geo-optimizer/)。

人工确认留在 CLI 外面。`apply` 必须带 `--confirm`，`--dry-run` 同样要带。没有已批准集合时拒绝写回。

```bash
./scripts/shopify-geo-optimizer.sh plan --group-id A

# 批准全部 P0，写回 Admin，再调用 workshop geo-eval
./scripts/shopify-geo-optimizer.sh apply --group-id A --confirm --approve-all-p0

# 不调用 Shopify、不再评分：写入 fixture after 分
./scripts/shopify-geo-optimizer.sh apply --group-id A --confirm --approve-all-p0 --dry-run
```

输入：

```text
.workshop/<group_id>/geo.before.json
.workshop/<group_id>/brand-brief.json
.workshop/<group_id>/connection.json    # 只接受 Preview Store
```

写入：

```text
.workshop/<group_id>/geo.proposal.json   # plan
.workshop/<group_id>/geo.approved.json   # apply
.workshop/<group_id>/geo.after.json      # apply
.workshop/<group_id>/workshop-state.yaml # geo.optimizer_status、geo.after_score
```

建议条目：`field`, `before`, `after`, `reason`, `expected_impact`, `priority`, `confidence`。

- `plan` 不写 Admin。
- 只接受 Preview Store。`--password` 直接拒绝。
- 真实写回用 Admin `productUpdate`，不发布主题，不改渠道。
- 写回之后执行 `shopify-geo-eval-workshop apply --confirm --phase after`。那个命令只写 `geo.after.json` 和 `geo.after_score`，不覆盖 before 分。
- `--dry-run` 不调用 Shopify，也不调用再评分。它写入 `fixtures/geo.after.json` 这份假 after 分。
- 可以写店铺域名。禁止写入 accessUrl、Admin token、店面密码。

## 验收

- 薄商品可生成 3–8 条建议，含 before / after / reason
- 一批 P0 一次确认可写回
- after 分与 before 同一套 workshop scorecard，不另起一套打分
