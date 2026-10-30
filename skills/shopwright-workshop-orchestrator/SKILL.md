---
name: shopwright-workshop-orchestrator
description: >-
  ShopWright Workshop 总控：创建 Preview Store → 导入 → Brief → 骨架 Theme →
  商品渠道发布 → Workshop GEO before → 批 P0 优化 → after → Summary。
  把店铺域名和 accessUrl 会话句柄交给 GEO。不实现店面密码传递。
  用于 Google×Beansmile 现场动手课，不是完整建站产品。
---

# shopwright-workshop-orchestrator

## 何时使用

- 启动或恢复一场 ShopWright Workshop 小组流程
- 学员问「我们到哪一步了 / 下一步做什么」
- 需要写 Workshop Summary

## 不要做

- 不要跳过人工确认点
- 不要连接学员自己的正式店
- Preview Store 是唯一店路径。不要课前按人数预开 Dev Store，也不要在 Preview 创建失败时改挂 Dev Store；失败时现场排障（重试、换店名、查 CLI/网络），必要时该组暂停由讲师协助
- 不要 Publish Theme
- 不要调用完整版 `shopify-geo-eval`；只用 `shopify-geo-eval-workshop`
- 不要默认让学员逐条审完全部 GEO 建议
- 不要发明店面密码管道：不读取、不缓存、不向 GEO / 学员 / 状态文件传递 Opening soon 密码
- 不要把 `accessUrl` 原文写入 `workshop-state.yaml`、Summary 或仓库

## 流程

```text
create_preview_store
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

## 商品渠道发布运行时（GEO 前确认步）

`confirm_publish_products_for_geo` 的已落地命令是：

```bash
./scripts/publish-products-for-geo.sh plan --group-id A
# 人工确认 plan 中的 participant_confirm_copy / risk_one_liner 后：
./scripts/publish-products-for-geo.sh apply --group-id A --confirm
# 无网络演练：
./scripts/publish-products-for-geo.sh apply --group-id A --confirm --dry-run
```

实现见 [runtime/publish-products-for-geo](../../runtime/publish-products-for-geo/)。它只接受 Preview Store +
`write_products` / `write_publications`，只处理本组 import result 或显式 `--product-id`；将商品设为
Active 并发布到 Online Store，主题始终保持 Unpublished。成功后写
`products.channel.json` 并把 `workshop-state.yaml` 的 `products.channel_status` 更新为
`online_store_active`。`apply` 缺少 `--confirm` 必须拒绝。

## 交给 GEO 的连接信息

`run_geo_eval_before` / `run_geo_eval_after` 只接收：

```text
store_domain
store_type                    # 固定 preview；Preview Store 是唯一店路径
storefront_session: access_url
  # 句柄：解析为当次 shopify store info / shopify store open 会话
  # 解析在运行时完成；状态文件里不落 URL
theme.preview_url             # unpublished，含 ?preview_theme_id=
```

会话缺失或 accessUrl 抓取失败：GEO 以 `evidence_mode=admin_only` 继续，并记下 restriction。恢复手段是重新 `shopify store open` 或 `shopify store info`。

## 状态

读写 `workshop-state.yaml`（见 `templates/workshop-state.schema.yaml`）。关键字段：

- `connection.store_type`：固定为 `preview`（唯一店路径）
- `connection.auth`：`cli_cached_admin_token`
- `connection.storefront_session`：`access_url` | `none`
- `products.channel_status`：`draft` | `online_store_active`
- `theme.preview_url`，`theme.fallback_used`
- `geo.evidence_mode`，`geo.before_score`，`geo.after_score`
- `geo.optimizer_status`：如 `approved_p0_batch`

## 人工确认点（必须挡住）

1. 确认创建并连接 Preview Store（失败时现场排障；必要时该组暂停）
2. Excel 导入
3. Brand Brief 锁定
4. Theme 创建或 Demo Theme Fallback
5. 商品 Active + Online Store（GEO 前）
6. 批准全部 P0（+ 可选精审）
7. 生成最终 Summary

## 学员话术要点

- 店是现场创建的 Preview Store，不需要你已有 Partner 账号
- 看店面时你会看到 `shopify store open` 或 access 流程；未登录裸开是 Opening soon
- 主题不发布；预览链接带 `preview_theme_id`
- GEO 前会请你确认「商品放到 Online Store 渠道」
- 优化点「批准全部 P0」，再选 1–2 个商品细看即可

## 验收

- 能显示完成步骤与下一步
- 跳过确认会被拒绝并提示
- 调用 GEO 时带上域名和 accessUrl 会话句柄，状态与 Summary 中没有密码字段、没有 accessUrl 原文
- Summary 列出交付清单（见方案 §12）
