---
name: product-excel-import
description: >-
  将 Workshop Excel/CSV（5–10 SKU）校验并导入为 Shopify Draft 商品；支持 Demo 图 Fallback。
  渠道发布（Active + Online Store）由编排器在 GEO 前另步确认，本 skill 默认不发布渠道。
---

# product-excel-import

## 何时使用

学员上传商品表，或使用样例 `templates/products.sample.csv`。

## 流程

```text
上传 → 字段识别 → 校验 → 预览 ready/warning/blocked
  → 人工确认导入 → 写 Draft Products → 结果 JSON
```

## 字段

核心：`handle title description product_type vendor tags price compare_at_price sku inventory_qty image_url status`  
SEO/GEO：`seo_title seo_description faq brand gtin mpn material color size google_product_category condition`

## 校验

- **阻断**：缺 title；price 非法；image 不可访问且未开 Demo 图；handle/SKU 重复  
- **警告**：缺 seo/faq/gtin/material/color/size  
- **必填**：title description price sku image_url product_type  

## 状态策略（v0.2）

- 默认 `shopify_status=draft`，**不**发布销售渠道  
- GEO 演示前由 orchestrator 调用「发布到 Online Store」确认步（可复用本 skill 的 batch publish 子命令，但须单独确认）  

## 输出

```json
{
  "total_rows": 8,
  "ready": 7,
  "warning": 1,
  "blocked": 0,
  "imported": 7,
  "failed": 0,
  "default_status": "draft",
  "results": []
}
```

## 验收

- 5–10 SKU；预览后才写入；支持 Demo 图开关  
