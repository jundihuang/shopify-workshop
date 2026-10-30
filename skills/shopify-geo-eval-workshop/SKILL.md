---
name: shopify-geo-eval-workshop
description: >-
  Workshop 专用简化 GEO：5 维、5–10 SKU、5–10 分钟 Scorecard。
  证据=Admin 主 + preview_theme_id 辅 + technical 降权。
  禁止调用完整版 shopify-geo-eval（9+7 维全站爬虫/客户 deck）。
---

# shopify-geo-eval-workshop

## 隔离声明（必读）

| | 完整版 `shopify-geo-eval` | 本 skill |
|---|---|---|
| 用途 | 客户正式诊断 | 现场 Workshop |
| 维度 | 9+7 平铺 | **5 维** |
| 范围 | 全站抓取 | **5–10 SKU** |
| 耗时 | 长 | **5–10 分钟** |
| 现场 | **禁止** | **唯一允许** |

不要 `cd` 到完整版 skill 目录，不要跑其 `scripts/run.py` / `audit.py` / `build_report.py`。

## 前置条件

- Dev Store 已连接  
- `theme.preview_url` 可用  
- 商品已 **Active + Online Store**（编排器确认步之后）；否则只允许 Admin 层预检并明确标注「非完整店面分」  

## 证据模式（建议）

```text
A Admin API     — 主：字段完备、SEO、属性
B Preview HTML  — 辅：?preview_theme_id= + 密码会话，schema/结构
C Technical     — 降权：robots/sitemap/products.json（密码店可 restricted）
```

详见仓库 `docs/research-preview-geo.md`。

## 5 维模型

| 维度 | 权重 |
|---|---:|
| Product Data Completeness | 30% |
| Search Findability | 25% |
| AI Understandability | 20% |
| Purchase Trust | 15% |
| Technical Visibility | 10% |

总分 100；等级 A+/A/B/C/D 同方案。商品层权重见方案 §5.6。

## 输出

符合 `templates/geo-score.schema.json`：

- `geo_score`, `grade`, `dimensions`, `top_issues`, `products[]`  
- `evidence_mode`, `restrictions[]`  
- 每 issue 带 `priority`: P0/P1/P2  

## 验收

- 时限内出分；前后可比  
- 样本 ≤10 SKU；无全站爬虫  
