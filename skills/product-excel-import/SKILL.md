---
name: product-excel-import
description: >-
  将 Workshop Excel/CSV（5–10 SKU）校验并导入为 Shopify Draft 商品；支持 Demo 图 Fallback。
  渠道发布（Active + Online Store）由编排器在 GEO 前另步确认，本 skill 默认不发布渠道。
---

# product-excel-import

## 何时使用

学员上传商品表，或使用 Workshop 样例。主 Demo 样例来自合作伙伴
[INFLATION / inflationwear.com](https://inflationwear.com/collections/tshirt)：

- `templates/products.inflationwear-tshirt.sample.csv`（8 SKU）
- `templates/products.inflationwear-tshirt.sample.xlsx`（同一份数据的 Excel 版本）
- `templates/products.inflationwear-tshirt.README.md`（来源与使用说明）

`templates/products.sample.csv` 仅作为极小 fallback 保留，不再作为主 Demo 叙事。

## 流程

```text
上传 → 字段识别 → 校验 → 预览 ready/warning/blocked
  → 人工确认导入 → 写 Draft Products → 结果 JSON
```

## 字段

核心：`handle title description product_type vendor tags price compare_at_price sku inventory_qty image_url status`  
SEO/GEO：`seo_title seo_description faq brand gtin mpn material color size google_product_category condition`

未知列安全忽略，例如 `source_url` 只用于溯源，不会进入 Shopify 写入 payload。

## 校验

- **阻断**：缺 title / description / product_type / sku；price 非法；image 缺失或不可访问且未开 Demo 图；handle/SKU 重复
- **警告**：缺 seo_title、seo_description、faq、gtin、material、color、size 等 GEO 完整度字段
- **必填**：title description price sku image_url product_type
- 图片来源默认只校验 URL 形状；需要现场探测可访问性时加 `--check-images`

## 状态策略（v0.2）

- 默认 `shopify_status=draft`，**不**发布销售渠道
- 源表里的 `status` 会被安全地强制为 `draft`，并产生 warning
- GEO 演示前由 orchestrator 调用「发布到 Online Store」确认步（不在本 skill 的导入命令内）

## 运行时

实现位于 `runtime/product-excel-import/`，入口为 `scripts/product-excel-import.sh`。
要求 Node.js 20+；不依赖 npm 包。XLSX 由运行时内置 ZIP/XML reader 解析。

### 1. validate

```bash
./scripts/product-excel-import.sh validate \
  --group-id A \
  --file templates/products.inflationwear-tshirt.sample.csv
```

写入：

```text
.workshop/<group_id>/products.import.preview.json
```

Preview 包含 `field_map`、被忽略列、每行 `ready|warning|blocked` 分类、阻断/警告原因、以及强制 `default_status=draft` 的目标 payload。

### 2. import（人工确认后）

`import` 只读取已审阅的 preview。真实导入必须显式传 `--confirm`；CLI 不会在终端里弹确认问题，
人工确认点由 orchestrator / 讲师在 CLI 外部完成。

```bash
./scripts/product-excel-import.sh import \
  --group-id A \
  --confirm
```

写入：

```text
.workshop/<group_id>/products.import.result.json
```

导入使用 `connection.json` 中的 Preview Store 域名和 Shopify CLI cached Admin auth，调用
`shopify store execute --allow-mutations` 执行 Admin GraphQL。缺失 `connection.json`、
`store_type != preview`、或 `write_products` scope 未确认时一律拒绝。

### 3. run / dry-run

```bash
# validate only；未 --confirm 不会写 Shopify
./scripts/product-excel-import.sh run \
  --group-id A \
  --file templates/products.inflationwear-tshirt.sample.xlsx

# 端到端演练：validate + fixture fake import；无网络写入
./scripts/product-excel-import.sh run \
  --group-id A \
  --file templates/products.inflationwear-tshirt.sample.csv \
  --dry-run

# 人工确认后真实导入
./scripts/product-excel-import.sh run \
  --group-id A \
  --file templates/products.inflationwear-tshirt.sample.csv \
  --confirm
```

`--dry-run` 仍会读写本地 preview / fake result JSON，但不会调用 Shopify CLI，也不会创建商品。
导入结果来自 `runtime/product-excel-import/fixtures/product-create.success.json`。

### Demo 图

```bash
./scripts/product-excel-import.sh validate \
  --group-id A \
  --file templates/products.inflationwear-tshirt.sample.csv \
  --demo-images
```

`--demo-images` 会把缺失或（在 `--check-images` 下）不可访问的图片替换成 Shopify placeholder。
现场网络受限时推荐打开。

### 安全边界

- 不写 `accessUrl`、Admin token、secret、password 到任何 artifact
- 不调用任何商品发布 / channel mutation；导入 payload 固定 `status: DRAFT`
- 只使用连接产物中的 Preview Store 域名，不回退 Dev Store 或正式店
- 所有 artifact 写盘前做敏感字段检查

## 输出

```json
{
  "total_rows": 8,
  "ready": 0,
  "warning": 8,
  "blocked": 0,
  "imported": 8,
  "failed": 0,
  "default_status": "draft",
  "results": []
}
```

实际 runtime 输出还会带 `shopify_status=draft`、`channels_published=false` 与 artifact 路径。

## 验收

- 5–10 SKU；预览后才写入；支持 Demo 图开关
- CSV 与 XLSX 均能解析 Inflation Wear 样例
- 缺 title、坏 price、重复 SKU 被 blocked
- `npm test` 全绿
