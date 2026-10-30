---
name: brand-intake
description: >-
  把学员填写的品牌资料与可选 Logo/色值整理为 brand-brief.json，供骨架 Theme 填充与 GEO 文案约束。
  超时可套用预置 Demo Brief。
---

# brand-intake

## 何时使用

商品导入后、Theme 之前；或学员更新品牌话术时。

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

## 验收

- JSON 可被 `shopify-theme-builder` 与 `shopify-geo-optimizer` 直接消费  
- 识别夸大/医疗风险表述并写入 `tone.avoid`  
