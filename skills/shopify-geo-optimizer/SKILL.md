---
name: shopify-geo-optimizer
description: >-
  根据 shopify-geo-eval-workshop 结果生成商品 Before/After 建议；
  现场默认「批准全部 P0」+ 可选 1–2 商品精审，确认后写回 Admin 并触发再评分。
---

# shopify-geo-optimizer

## 何时使用

GEO Before 已完成；需要优化并演示涨分。

## 原则

```text
诊断来自 shopify-geo-eval-workshop
建议约束来自 brand-brief + GEO rules
写回前必须确认（批量 P0 = 一次确认）
写回后调用 shopify-geo-eval-workshop 再评分
```

## 现场 UX（强制）

1. 主按钮：**批准全部 P0**  
2. 精审：最多 1–2 个商品展开 Before/After（approve / edit / ignore）  
3. P1 默认折叠；时间不够跳过  
4. **禁止**引导学员逐条审 8×N 条  

## P0 字段

```text
title, description, meta_title, meta_description, key attributes
```

约束：含品类/卖点/场景；不夸大；无医疗保证；meta ≈60 / ≈150 字符。

## 写回流程

```text
生成 geo.proposal.json
  → 批 P0 / 精审 → geo.approved.json
  → Admin 更新商品
  → shopify-geo-eval-workshop → geo.after.json
```

## 建议条目格式

```text
field, before, after, reason, expected_impact, priority, confidence
```

## 验收

- 每商品 3–8 条建议可用  
- 一批 P0 可写回  
- after_score 与 before 同分口径  
