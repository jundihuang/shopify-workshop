# shopify-workshop

Google × Beansmile **ShopWright Workshop** 文档与 Skill 包。

目标：让现场学员在约 90 分钟内用 **Preview Store** 完成一场可演示的建站与 GEO。每组执行 `shopify store create preview --name '…' --json`（不需要已有 Partner 账号）；CLI 缓存 Admin API token。商品完备性走 Admin API；需要店面 HTML/schema 时使用 `shopify store info` / `shopify store open` 的 **accessUrl** 会话。**Preview Store 是唯一店路径。** Preview 创建失败时现场排障（重试 `shopify store create preview`、换店名、查 CLI/网络）；必要时该组暂停由讲师协助，不改挂 Dev Store，也不课前按人数预开 Dev Store。真实 accessUrl 与店面密码都不进文档。

1. 创建并连接 Preview Store  
2. 导入 5–10 个商品  
3. 生成 Brand Brief  
4. 填充 Unpublished Theme 并拿到带 `?preview_theme_id=` 的 `previewUrl`  
5. 用 Workshop 版 GEO 打分 → 批量确认 P0 优化 → 再打分  

本仓库以**方案与 Skill 契约**为主，已落地七个可运行 MVP：[runtime/shopify-store-connect](runtime/shopify-store-connect/)（Step 1：创建 Preview Store、校验 scopes、写安全连接产物）、[runtime/product-excel-import](runtime/product-excel-import/)（Step 2：CSV/XLSX 校验、ready/warning/blocked 预览、Draft 商品导入）、[runtime/publish-products-for-geo](runtime/publish-products-for-geo/)（GEO 前人工确认：商品 Active + Online Store，Theme 保持 Unpublished）、[runtime/brand-intake](runtime/brand-intake/)（Brand Brief：把学员答案整理成 schema 校验过的 `brand-brief.json`，超时可加载 Aurora Skincare Demo Brief；只写本地 JSON）、[runtime/shopify-theme-builder](runtime/shopify-theme-builder/)（骨架填充 Brand Brief，`shopify theme push --unpublished`，返回带 `?preview_theme_id=` 的 `preview_url`；超时挂 Demo Theme，不发布主题）、[runtime/shopify-geo-eval-workshop](runtime/shopify-geo-eval-workshop/)（Workshop 5 维 GEO before 分：只读 Admin 字段，最多 10 个商品；HTML 可选且不落 accessUrl）与 [runtime/shopify-geo-optimizer](runtime/shopify-geo-optimizer/)（按 workshop scorecard 和 Brand Brief 生成 P0 before/after，确认后写回并再评分；不携带完整版诊断）。

商品导入主 Demo 使用合作伙伴 [INFLATION / inflationwear.com](https://inflationwear.com/collections/tshirt) 的公开商品样例（8 SKU）：

```bash
./scripts/product-excel-import.sh validate \
  --group-id A \
  --file templates/products.inflationwear-tshirt.sample.csv

# 人工审阅 .workshop/A/products.import.preview.json 后：
./scripts/product-excel-import.sh import --group-id A --confirm

# 无网络写入的端到端演练：
./scripts/product-excel-import.sh run \
  --group-id A \
  --file templates/products.inflationwear-tshirt.sample.xlsx \
  --dry-run
```

导入固定写 Draft，不发布 Online Store 或其他销售渠道。

GEO 演示前的渠道发布是独立的人工确认步骤（不并入 import）：

```bash
./scripts/publish-products-for-geo.sh plan --group-id A
./scripts/publish-products-for-geo.sh apply --group-id A --confirm
./scripts/publish-products-for-geo.sh apply --group-id A --confirm --dry-run
```

它只接受 Preview Store，必须带 `--confirm`，把本组导入商品设为 Active 并发布到 Online Store，但**永不发布 Theme**，也不持久化 `accessUrl`。`--dry-run` 不访问 Shopify。

Brand Brief 是渠道发布之后落地的下一个 MVP。现场顺序仍在骨架 Theme 之前。它只写本地 JSON：

```bash
./scripts/brand-intake.sh plan \
  --group-id A \
  --answers templates/brand-intake.answers.sample.json

# 人工审阅 missing[] 与 tone.avoid 后：
./scripts/brand-intake.sh apply \
  --group-id A \
  --confirm \
  --answers templates/brand-intake.answers.sample.json

# 超时或没有答案文件：加载 Aurora Skincare，不访问网络
./scripts/brand-intake.sh apply --group-id A --confirm --demo --dry-run
```

`plan` 校验答案并列出 `missing[]` 与夸大/医疗风险，不写最终 brief。`apply` 必须带 `--confirm`（含 `--dry-run`）。成功后写入 `.workshop/<group_id>/brand-brief.json`，并把 `workshop-state.yaml` 的 `brand.status` 更新为 `done` 或 `fallback_demo`。locale / currency 默认 `en-US` / `USD`。这一步不调用 Shopify，不改 Theme，不改商品，不写 `accessUrl`。

Unpublished Theme 是 Brand Brief 之后落地的下一个 MVP。它只填充预置骨架，不从零生成整站：

```bash
./scripts/shopify-theme-builder.sh plan --group-id A

# 人工审阅色、文案与风险后：
./scripts/shopify-theme-builder.sh apply --group-id A --confirm

# 不调用 Shopify CLI，写入 fixture manifest：
./scripts/shopify-theme-builder.sh apply --group-id A --confirm --dry-run

# 超时或强制改挂文档中的 Demo Theme：
./scripts/shopify-theme-builder.sh apply --group-id A --confirm --demo
```

`plan` 读取 `.workshop/<group_id>/brand-brief.json` 和 `connection.json`，只接受 Preview Store，列出将写入的 settings / sections 与风险，不 push。`apply` 必须带 `--confirm`（含 `--dry-run`）。成功后写 `theme.manifest.json`，并把 `workshop-state.yaml` 的 `theme.status` 更新为 `unpublished` 或 `fallback`。`preview_url` 形如 `https://{store}/?preview_theme_id={id}`。真实上传用 `shopify theme push --unpublished --json`；只有 CLI 不提供该标志时才改用 `theme share --json`。超过约 3.5 分钟（上限 4 分钟）或上传失败时挂 Demo Theme（`fallback_used=true`）。这一步不发布主题，不改商品渠道，不写 `accessUrl`。

Workshop GEO before 是主题预览之后、优化器之前的只读打分。这是一份 workshop scorecard，不是完整诊断：

```bash
./scripts/shopify-geo-eval-workshop.sh plan --group-id A

# 人工审阅维度、样本上限与证据计划后：
./scripts/shopify-geo-eval-workshop.sh apply --group-id A --confirm

# 不调用 Shopify、不抓 accessUrl，用 fixture 商品打分：
./scripts/shopify-geo-eval-workshop.sh apply --group-id A --confirm --dry-run
```

`plan` 只接受 Preview Store，写出 `geo.plan.json`，不打分。`apply` 必须带 `--confirm`（含 `--dry-run`）。它只读 Admin 的 title / description / media / SEO 字段，样本最多 10 个商品，按已发布的 5 维权重写出 `geo.before.json` 和一页 `geo.before.md`，并更新 `workshop-state.yaml` 的 `geo.before_score`、`geo.evidence_mode`、`geo.restrictions`。`--dry-run` 或跳过 HTML 时 `evidence_mode=admin_only`。店面 HTML 只用当次 `shopify store info` 会话，用完即弃。商品未处于 Active + Online Store 时只做 Admin 预检。这一步不改商品、不改主题、不接收店面密码，也不把 accessUrl 写入产物。`--phase after` 改写 `geo.after.json` 和 `geo.after_score`，留给优化器在写回之后调用，不覆盖 before 分。

P0 写回是 before 分之后的下一步。建议只来自 workshop scorecard 和 Brand Brief，不使用完整版诊断：

```bash
./scripts/shopify-geo-optimizer.sh plan --group-id A

# 批准全部 P0，写回商品字段，再调用 workshop geo-eval：
./scripts/shopify-geo-optimizer.sh apply --group-id A --confirm --approve-all-p0

# 不调用 Shopify：写入 fixture after 分
./scripts/shopify-geo-optimizer.sh apply --group-id A --confirm --approve-all-p0 --dry-run
```

`plan` 读 `geo.before.json` 和 `brand-brief.json`，写出 `geo.proposal.json`，不写 Admin。`apply` 必须带 `--confirm`。`--approve-all-p0` 一次批准 title、description、meta title、meta description 和 key attributes；P1 折叠可跳过；精审最多 1–2 个商品。没有已批准集合时拒绝写回。只接受 Preview Store。文案带品类、卖点和场景，并去掉 `tone.avoid` 和医疗/夸大说法。真实写回后调用 `shopify-geo-eval-workshop --phase after`。`--dry-run` 不访问 Shopify。这一步不发布主题，不把 accessUrl 写入产物。

## 文档导航

| 文档 | 用途 |
|---|---|
| [docs/ShopWright-Workshop-Skills-方案-v0.2.md](docs/ShopWright-Workshop-Skills-方案-v0.2.md) | 主方案（v0.2 修订稿） |
| [docs/review-notes-v0.1.md](docs/review-notes-v0.1.md) | v0.1 审查结论 |
| [docs/research-preview-geo.md](docs/research-preview-geo.md) | Preview Store / accessUrl / GEO 证据 |
| [docs/dry-run-preview-store-2026-10-30.md](docs/dry-run-preview-store-2026-10-30.md) | 2026-10-30 Preview Store dry run |
| [docs/participant-journey.md](docs/participant-journey.md) | 学员操作旅程 |
| [docs/facilitator-runbook.md](docs/facilitator-runbook.md) | 讲师 Runbook / 现场排障 |

## Skills（7）

```text
shopwright-workshop-orchestrator   总控与状态
shopify-store-connect              创建 Preview Store，使用 CLI 缓存的 Admin token
product-excel-import               Excel → 商品（两阶段状态）
brand-intake                       Brand Brief
shopify-theme-builder              骨架 Theme + preview_url
shopify-geo-eval-workshop          Workshop 简化 GEO（独立于完整版）
shopify-geo-optimizer              P0 批量确认 + 写回
```

完整版客户诊断 skill `shopify-geo-eval`（9+7 维爬虫流水线）**不在本仓库**，现场禁止直接调用。

## 安全边界（硬规则）

- **Preview Store 是唯一店路径**；不连接学员正式店，不改挂 Dev Store，也不课前按人数预开 Dev Store
- Theme 只写 **Unpublished**，`previewUrl` 带 `?preview_theme_id=`，用 store open / accessUrl 打开
- 不读订单 / 客户 PII，不改 Checkout
- 不通过 Admin 读取或设置 Opening soon 店面密码（明文不可读；`onlineStorePasswordProtectionUpdate` 不存在）
- 所有写入需人工确认
- GEO 演示前商品可升为 Active + Online Store 渠道；**不 Publish Theme**

## 快速了解证据策略

详见 [research-preview-geo.md](docs/research-preview-geo.md) 与 [dry-run-preview-store-2026-10-30.md](docs/dry-run-preview-store-2026-10-30.md)。摘要：

- 未登录 `*.myshopify.com` 是 Opening soon；`/products.json` 为 401；sitemap 常为 404
- **主证据**：Admin API 评商品完备性。纯 Draft 做不了店面层 GEO
- **店面 HTML/schema**：`accessUrl` 会话，加上 unpublished 主题的 `preview_theme_id`。限流重试；失败则只出 Admin 分
- CLI：`shopify store create preview --name '…' --json`，然后 `shopify theme push --unpublished`

## 模板与样例

见 `templates/`：Excel 字段说明、Brand Brief schema、[Demo Brief（Aurora Skincare）](templates/brand-brief.demo.aurora-skincare.json)、[学员答案样例](templates/brand-intake.answers.sample.json)、[Demo Theme manifest](templates/theme.manifest.demo.json)、workshop-state / geo-score schema。主题骨架在 [runtime/shopify-theme-builder/skeleton](runtime/shopify-theme-builder/skeleton/)。

商品导入样例优先使用：[templates/products.inflationwear-tshirt.sample.csv](templates/products.inflationwear-tshirt.sample.csv)、[templates/products.inflationwear-tshirt.sample.xlsx](templates/products.inflationwear-tshirt.sample.xlsx)，来源与授权说明见 [templates/products.inflationwear-tshirt.README.md](templates/products.inflationwear-tshirt.README.md)。`templates/products.sample.csv` 仅保留为极小 fallback。

## 仓库状态

文档包由 Grok Bot 在 box 上生成；推送到 `https://github.com/jundihuang/shopify-workshop` 由维护者处理。
