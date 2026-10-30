---
name: shopify-geo-eval-workshop
description: >-
  Workshop 专用简化 GEO：5 维、5–10 SKU、5–10 分钟 Scorecard。
  商品完备性以 Admin API 为主；店面 HTML/schema 用 accessUrl（shopify store info /
  shopify store open 会话）按需抓取。从不要求 Opening soon 店面密码。
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

- Preview Store 已连接（唯一店路径），CLI Admin token 可用
- 编排器传入 `store_domain`、`storefront_session=access_url`（句柄，不是把 URL 贴进提示词），以及 `theme.preview_url`（`?preview_theme_id=`）
- 商品已 **Active + Online Store**（编排器确认步之后）；否则只允许 Admin 层预检，并标明「非完整店面分」

没有店面密码输入。调用方如果只提供了密码、没有 accessUrl 会话，拒绝该凭证并改走 Admin。

## 证据模式

```text
A Admin API      — 主：字段完备、SEO、属性、媒体、publications
B accessUrl HTML — 按需：shopify store info / shopify store open 的会话
                    + ?preview_theme_id= ，抓 schema / 页面结构
C Technical      — 降权：未登录 robots 200、/products.json 401、sitemap 常 404
```

抓 B 的规则：

- 只用当次 CLI 会话里的 `accessUrl`。用完即弃，不写入 scorecard 文件。
- 遇到 **429**：退避重试，有限次数。仍失败则 `evidence_mode=admin_only`，`restrictions` 加上 `access_url_rate_limited`。
- 会话过期：请编排器重新 `shopify store open` 或 `shopify store info`，然后重试 B。不要改问密码。
- 未登录直接抓 `*.myshopify.com` 会得到 Opening soon / 401 / 404，不能当作 B 的成功。

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
Product Data Completeness 只依赖 A。B 缺失时 Search / AI / Trust 用 Admin 能覆盖的部分给分，并在 restrictions 说明 HTML 未取到。Technical 在未登录 401/404 时封顶或标 restricted。

## 输出

符合 `templates/geo-score.schema.json`：

- `geo_score`, `grade`, `dimensions`, `top_issues`, `products[]`
- `evidence_mode`：`hybrid_admin_preview`（A+B）或 `admin_only`
- `restrictions[]`：例如 `unauthenticated_storefront_restricted`、`access_url_rate_limited`
- 每 issue 带 `priority`: P0/P1/P2

输出里可以有店铺域名和 `preview_url`。禁止出现 accessUrl、Admin token、店面密码。

## 运行时

实现：[runtime/shopify-geo-eval-workshop](../../runtime/shopify-geo-eval-workshop/)。这是一份 workshop scorecard，不是完整诊断。打分只检查 Admin 的 title / description / media / SEO 字段，再套用上面的 5 维权重。

人工确认留在 CLI 外面。`apply` 必须带 `--confirm`，`--dry-run` 同样要带。

```bash
./scripts/shopify-geo-eval-workshop.sh plan --group-id A

# 只读打分并写 before scorecard
./scripts/shopify-geo-eval-workshop.sh apply --group-id A --confirm

# 不调用 Shopify、不抓 HTML：用 fixture 商品打分
./scripts/shopify-geo-eval-workshop.sh apply --group-id A --confirm --dry-run

# 即使已连接，也只评 Admin 字段
./scripts/shopify-geo-eval-workshop.sh apply --group-id A --confirm --skip-html

# 优化器写回之后再评分：只写 after，不覆盖 before
./scripts/shopify-geo-eval-workshop.sh apply --group-id A --confirm --phase after
```

写入：

```text
.workshop/<group_id>/geo.plan.json          # plan
.workshop/<group_id>/geo.before.json        # apply，符合 templates/geo-score.schema.json
.workshop/<group_id>/geo.before.md
.workshop/<group_id>/geo.after.json         # apply --phase after
.workshop/<group_id>/geo.after.md
.workshop/<group_id>/workshop-state.yaml    # before_score，或 --phase after 时的 after_score
```

- 只接受 Preview Store。`apply` 不改商品、不改主题。
- 样本最多 10 个商品。Admin 查询是只读的。
- `--dry-run` 读取 `runtime/shopify-geo-eval-workshop/fixtures/admin-products.success.json`，`evidence_mode=admin_only`，restrictions 含 `html_evidence_skipped`。
- 商品 `channel_status` 不是 `online_store_active` 时只做 Admin 预检，并记下 `channel_not_online_store`。
- HTML 仅在渠道已确认、会话句柄为 `access_url`、且没有 `--dry-run` / `--skip-html` 时，通过当次 `shopify store info` 抓取。URL 不入库。失败、429 或 Opening soon 页面都降为 `admin_only`。
- 可以写店铺域名和安全的 `preview_url`（`https://{store}/?preview_theme_id={id}`）。禁止写入 accessUrl、Admin token、店面密码。
- 传入 `--password` 或 connection 里带店面密码字段时直接拒绝。
- `--phase after` 只更新 `geo.after_score`。`before_score`、`optimizer_status` 和 restrictions 保持原样。默认 `--phase before`。优化器用这一步做再评分，本 runtime 仍然只读。

## 验收

- 时限内出分；前后可比
- 样本 ≤10 SKU；无全站爬虫
- 实现中不存在「从 Admin 读取 Opening soon 密码」或调用店面密码更新的步骤
- `cd runtime/shopify-geo-eval-workshop && npm test` 覆盖：schema、5 维、dry-run、无 `--confirm` 拒绝、不落 accessUrl、跳过 HTML 时 `admin_only`、样本 ≤10、分数到等级的映射
