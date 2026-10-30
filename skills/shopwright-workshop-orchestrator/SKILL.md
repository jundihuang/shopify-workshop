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

## 品牌 Brief 运行时（渠道发布之后的下一个 MVP）

`create_brand_brief` 的已落地命令是：

```bash
./scripts/brand-intake.sh plan --group-id A --answers templates/brand-intake.answers.sample.json
# 人工确认 plan 中的 missing[]、tone.avoid 与 participant_confirm_copy 后：
./scripts/brand-intake.sh apply --group-id A --confirm --answers templates/brand-intake.answers.sample.json
# 超时或没有答案文件：加载 Aurora Skincare，不访问网络
./scripts/brand-intake.sh apply --group-id A --confirm --demo --dry-run
```

现场顺序仍是导入之后、骨架 Theme 之前。实现见 [runtime/brand-intake](../../runtime/brand-intake/)。
它只写本地 JSON：`plan` 校验并列出 `missing[]` 与夸大/医疗风险，不落最终 brief；`apply` 必须带
`--confirm`（含 `--dry-run`）。成功后写 `.workshop/<group_id>/brand-brief.json`，并把
`brand.status` 更新为 `done`（学员答案，缺项用默认值）或 `fallback_demo`（Aurora Skincare）。
locale / currency 默认 `en-US` / `USD`。不调用 Shopify，不改 Theme，不改商品，不写 `accessUrl`。

## 骨架 Theme 运行时（Brand Brief 之后的下一个 MVP）

`build_theme_from_skeleton` 的已落地命令是：

```bash
./scripts/shopify-theme-builder.sh plan --group-id A
# 人工确认 plan 中的色、文案、风险与 participant_confirm_copy 后：
./scripts/shopify-theme-builder.sh apply --group-id A --confirm
# 无 Shopify CLI 调用的演练：
./scripts/shopify-theme-builder.sh apply --group-id A --confirm --dry-run
# 超时或强制 Demo Theme：
./scripts/shopify-theme-builder.sh apply --group-id A --confirm --demo
```

实现见 [runtime/shopify-theme-builder](../../runtime/shopify-theme-builder/)。它只接受 Preview Store +
`write_themes`，从 `.workshop/<group_id>/brand-brief.json` 填充预置骨架的 settings 与
Home / Collection / Product section，然后 `shopify theme push --unpublished --json`
（仅当 CLI 没有 `--unpublished` 时才改用 `theme share --json`）。成功后写
`theme.manifest.json`，并把 `theme.theme_id`、`theme.status`（`unpublished` 或 `fallback`）、
`theme.preview_url`、`theme.fallback_used` 写入 `workshop-state.yaml`。
`preview_url` 固定为 `https://{store}/?preview_theme_id={id}`。上传超过约 3.5 分钟或失败时挂
`templates/theme.manifest.demo.json` 描述的 Demo Theme，`fallback_used=true`。
`apply` 缺少 `--confirm` 必须拒绝。不发布主题，不改商品渠道，不写 `accessUrl`。

## Workshop GEO 运行时（只读 before 分）

`run_geo_eval_before` 的已落地命令是：

```bash
./scripts/shopify-geo-eval-workshop.sh plan --group-id A
# 人工确认 plan 中的 5 维、样本上限与 participant_confirm_copy 后：
./scripts/shopify-geo-eval-workshop.sh apply --group-id A --confirm
# 无 Shopify、无 HTML 的演练：
./scripts/shopify-geo-eval-workshop.sh apply --group-id A --confirm --dry-run
```

实现见 [runtime/shopify-geo-eval-workshop](../../runtime/shopify-geo-eval-workshop/)。这是一份 workshop scorecard，不是完整诊断。它只接受 Preview Store，只读 Admin 的 title / description / media / SEO 字段，样本最多 10 个商品，按已发布的 5 维权重打分。成功后写 `geo.before.json` 与短页 `geo.before.md`，并把 `geo.before_score`、`geo.evidence_mode`、`geo.restrictions` 写入 `workshop-state.yaml`。`after_score` 与 `optimizer_status` 由优化器写入。优化器再评分时调用同一 runtime 的 `apply --phase after`，不会覆盖 `before_score`。

HTML 只用编排器传来的 `storefront_session=access_url` 句柄，在运行时解析当次 `shopify store info` 会话，不把 URL 写入状态或 scorecard。会话缺失、`--dry-run`、`--skip-html`，或商品还不是 Active + Online Store 时，以 `evidence_mode=admin_only` 继续。`apply` 缺少 `--confirm` 必须拒绝。不改商品，不改主题，不接收店面密码。

## GEO 优化运行时（批 P0 写回）

`propose_geo_optimizations`、`human_review_p0_batch`、`apply_geo_optimizations` 和 `run_geo_eval_after` 的已落地命令是：

```bash
./scripts/shopify-geo-optimizer.sh plan --group-id A
# 人工确认「批准全部 P0」后：
./scripts/shopify-geo-optimizer.sh apply --group-id A --confirm --approve-all-p0
# 无 Shopify、无再评分的演练：
./scripts/shopify-geo-optimizer.sh apply --group-id A --confirm --approve-all-p0 --dry-run
```

实现见 [runtime/shopify-geo-optimizer](../../runtime/shopify-geo-optimizer/)。它只读 workshop scorecard 和 `brand-brief.json`，不读取完整版诊断。`plan` 写 `geo.proposal.json`，不写 Admin。`apply` 必须带 `--confirm`。`--approve-all-p0` 一次批准全部 P0；P1 折叠可跳过；`--deep-review` 最多 1–2 个商品。没有已批准集合时拒绝写回。只接受 Preview Store。

写回后调用 `shopify-geo-eval-workshop apply --confirm --phase after`，得到 `geo.after.json`，并更新 `geo.after_score` 与 `geo.optimizer_status`（批 P0 为 `approved_p0_batch`）。`--dry-run` 不调用 Shopify，写入 fixture after 分。不把 accessUrl、token、店面密码写入产物，不发布主题。

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
- `brand.brief_file`，`brand.status`：`pending` | `done` | `fallback_demo`
- `theme.theme_id`，`theme.status`：`unpublished` | `fallback`，`theme.preview_url`，`theme.fallback_used`
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
