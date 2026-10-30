---
name: shopwright-workshop-orchestrator
description: >-
  ShopWright Workshop 总控：按小组推进连接→导入→Brief→骨架 Theme→商品渠道发布→
  Workshop GEO before→批 P0 优化→after→Summary。维护 workshop-state，强制确认点。
  用于 Google×Beansmile 现场动手课，不是完整建站产品。
---

# shopwright-workshop-orchestrator

## 何时使用

- 启动或恢复一场 ShopWright Workshop 小组流程
- 学员问「我们到哪一步了 / 下一步做什么」
- 需要写 Workshop Summary

## 不要做

- 不要跳过人工确认点
- 不要连接非 Dev Store
- 不要 Publish Theme
- 不要调用完整版 `shopify-geo-eval` 爬虫流水线；只用 `shopify-geo-eval-workshop`
- 不要默认让学员逐条审完全部 GEO 建议

## 流程

```text
select_provisioned_store
  → import_products
  → create_brand_brief
  → build_theme_from_skeleton
  → confirm_publish_products_for_geo
  → run_geo_eval_before
  → propose_geo_optimizations
  → human_review_p0_batch
  → apply_geo_optimizations
  → run_geo_eval_after
  → generate_workshop_summary
```

委托子 skill：`shopify-store-connect`、`product-excel-import`、`brand-intake`、`shopify-theme-builder`、`shopify-geo-eval-workshop`、`shopify-geo-optimizer`。

## 状态

读写 `workshop-state.yaml`（见 `templates/workshop-state.schema.yaml`）。关键字段：

- `connection.provisioned`
- `products.channel_status`: `draft` | `online_store_active`
- `theme.preview_url`, `theme.fallback_used`
- `geo.evidence_mode`, `geo.before_score`, `geo.after_score`
- `geo.optimizer_status`: 如 `approved_p0_batch`

## 人工确认点（必须挡住）

1. 选组 / 确认预置连接  
2. Excel 导入  
3. Brand Brief 锁定  
4. Theme 创建或 Fallback  
5. 商品 Active + Online Store（GEO 前）  
6. 批准全部 P0（+ 可选精审）  
7. 生成最终 Summary  

## 学员话术要点

- 店是课前准备好的；你只要选小组  
- 主题不发布；打开的是 `preview_theme_id` 链接  
- GEO 前会请你确认「商品放到 Online Store 渠道」，店仍有密码  
- 优化点「批准全部 P0」，再选 1–2 个商品细看即可  

## 验收

- 能显示完成步骤与下一步  
- 跳过确认会被拒绝并提示  
- Summary 列出交付清单（见方案 §12）  
