# shopify-workshop

Google × Beansmile **ShopWright Workshop** 文档与 Skill 包。

目标：让现场学员在约 90 分钟内用 **Preview Store** 完成一场可演示的建站与 GEO。每组执行 `shopify store create preview --name '…' --json`（不需要已有 Partner 账号）；CLI 缓存 Admin API token。商品完备性走 Admin API；需要店面 HTML/schema 时使用 `shopify store info` / `shopify store open` 的 **accessUrl** 会话。**Preview Store 是唯一店路径。** Preview 创建失败时现场排障（重试 `shopify store create preview`、换店名、查 CLI/网络）；必要时该组暂停由讲师协助，不改挂 Dev Store，也不课前按人数预开 Dev Store。真实 accessUrl 与店面密码都不进文档。

1. 创建并连接 Preview Store  
2. 导入 5–10 个商品  
3. 生成 Brand Brief  
4. 填充 Unpublished Theme 并拿到带 `?preview_theme_id=` 的 `previewUrl`  
5. 用 Workshop 版 GEO 打分 → 批量确认 P0 优化 → 再打分  

本仓库以**方案与 Skill 契约**为主，已落地四个可运行 MVP：[runtime/shopify-store-connect](runtime/shopify-store-connect/)（Step 1：创建 Preview Store、校验 scopes、写安全连接产物）、[runtime/product-excel-import](runtime/product-excel-import/)（Step 2：CSV/XLSX 校验、ready/warning/blocked 预览、Draft 商品导入）、[runtime/publish-products-for-geo](runtime/publish-products-for-geo/)（GEO 前人工确认：商品 Active + Online Store，Theme 保持 Unpublished）与 [runtime/brand-intake](runtime/brand-intake/)（Brand Brief：把学员答案整理成 schema 校验过的 `brand-brief.json`，超时可加载 Aurora Skincare Demo Brief；只写本地 JSON）。Theme 与 GEO 仍按 `docs/` 与各 `skills/*/SKILL.md` 落地。

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

见 `templates/`：Excel 字段说明、Brand Brief schema、[Demo Brief（Aurora Skincare）](templates/brand-brief.demo.aurora-skincare.json)、[学员答案样例](templates/brand-intake.answers.sample.json)、workshop-state / geo-score schema。

商品导入样例优先使用：[templates/products.inflationwear-tshirt.sample.csv](templates/products.inflationwear-tshirt.sample.csv)、[templates/products.inflationwear-tshirt.sample.xlsx](templates/products.inflationwear-tshirt.sample.xlsx)，来源与授权说明见 [templates/products.inflationwear-tshirt.README.md](templates/products.inflationwear-tshirt.README.md)。`templates/products.sample.csv` 仅保留为极小 fallback。

## 仓库状态

文档包由 Grok Bot 在 box 上生成；推送到 `https://github.com/jundihuang/shopify-workshop` 由维护者处理。
