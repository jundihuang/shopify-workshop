# products.import.xlsx 字段说明

Workshop 商品导入模板。主 Demo 使用合作伙伴 Inflation Wear 样例：`products.inflationwear-tshirt.sample.csv` / `products.inflationwear-tshirt.sample.xlsx`（来源说明见 `products.inflationwear-tshirt.README.md`）。`products.sample.csv` 仅作为极小 fallback。也可按下列列做 Excel。

## 核心列

| 列名 | 必填 | 说明 |
|---|---|---|
| handle | 建议 | URL handle；空则由 title 生成 |
| title | 是 | 商品标题 |
| description | 是 | 正文（可含简单 HTML） |
| product_type | 是 | 品类 |
| vendor | 否 | 品牌/供应商 |
| tags | 否 | 逗号分隔 |
| price | 是 | 数字 |
| compare_at_price | 否 | 划线价 |
| sku | 是 | 唯一 |
| inventory_qty | 否 | 默认 10 |
| image_url | 是* | 可访问 URL；*或勾选 Demo 图 |
| status | 否 | 模板可写 draft；导入默认 draft |

## SEO / GEO 列

| 列名 | 必填 | 说明 |
|---|---|---|
| seo_title | 否 | ≈60 字符 |
| seo_description | 否 | ≈150 字符 |
| faq | 否 | JSON 数组字符串或 `Q\|A;;Q\|A` |
| brand | 否 | |
| gtin | 否 | |
| mpn | 否 | |
| material | 否 | |
| color | 否 | |
| size | 否 | |
| google_product_category | 否 | |
| condition | 否 | 默认 new |

## 校验（与 skill 一致）

- 阻断：缺 title / 非法 price / 图不可访问且无 Demo / handle·SKU 重复  
- 警告：缺 seo/faq/属性  

## 状态提醒

导入写入 **Draft**。GEO 演示前由编排器确认后改为 Active 并发布到 **Online Store**；主题仍 Unpublished。

未知列（例如 `source_url`）会被运行时安全忽略。可运行 `./scripts/product-excel-import.sh validate --group-id A --file <file>` 生成 preview。
