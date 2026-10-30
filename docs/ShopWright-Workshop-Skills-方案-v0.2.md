# ShopWright Workshop Skills 方案 v0.2

> 修订自 v0.1。审查笔记：[review-notes-v0.1.md](review-notes-v0.1.md)  
> Preview Store / GEO 调研：[research-preview-geo.md](research-preview-geo.md)  
> Dry run：[dry-run-preview-store-2026-10-30.md](dry-run-preview-store-2026-10-30.md)  
> 学员旅程：[participant-journey.md](participant-journey.md)  
> 讲师手册：[facilitator-runbook.md](facilitator-runbook.md)

## 1. 背景

Google 侧希望 Beansmile 组织一场 Shopify + AI Workshop。现有 PPT 覆盖「迁移、建站、GEO 优化」，现场需要更聚焦、可操作、可验证的流程。

**Workshop = 现场动手课**：陌生人也能在约 90 分钟内跟完，带走可演示成果——不是听 PPT，也不是完整咨询交付。

本方案定义 7 个 Workshop Skill：

```text
shopwright-workshop-orchestrator
shopify-store-connect
product-excel-import
brand-intake
shopify-theme-builder
shopify-geo-eval-workshop    ← v0.2 更名，与完整版隔离
shopify-geo-optimizer
```

第一版目标：支撑一场稳定、可演示、可动手的 Workshop。

### 1.1 v0.2 相对 v0.1 仍保留的变更

1. **商品两阶段**：导入默认 Draft；GEO 前确认后 Active + Online Store。否决「纯 Draft 做公开店面 GEO」。
2. **Theme**：预置骨架填充 + Fallback Demo Theme；`previewUrl` 带 `preview_theme_id`；不 Publish Theme；不用 `theme dev` 本地预览。
3. **GEO**：独立 `shopify-geo-eval-workshop`（5 维、5–10 SKU、5–10 分钟）；禁止调用完整版爬虫流水线。
4. **确认**：GEO「批准全部 P0」+ 1–2 商品精审。
5. **文档**：学员旅程、讲师 Runbook、调研结论。
6. **节奏**：连接缩短；Theme 缩短；插入「发布商品到渠道」；GEO 时间盒收紧。

连接方式与店面鉴权以 §1.2 为准。v0.2 初稿里的「课前预置 Dev Store」「Preview 失败改挂 Dev Store 讲师 fallback」和「把店面密码交给 GEO」均作废。

### 1.2 决策更新（2026-10-30）：Preview Store + accessUrl

Owner：Jayce。依据：[dry-run-preview-store-2026-10-30.md](dry-run-preview-store-2026-10-30.md)。

Workshop 不能给每位学员一家 Partner Dev Store。Workshop 只保留 Preview Store 一条店路径，锁定如下：

1. **唯一店路径 = Preview Store。** 每组现场执行 `shopify store create preview --name '…' --json`。不需要已有 Partner 账号或信用卡。CLI 缓存 Admin API token。dry run 所见 authScopes **包含** `write_products`、`write_themes`、`write_publications`。
2. **不设 Dev Store fallback。** Preview 创建失败时现场排障：重试 `shopify store create preview`、换店名、查 CLI/网络；必要时该组暂停并由讲师协助。不改挂 Dev Store，也不课前按人数预开 Dev Store。
3. **GEO 证据 = Admin API（主）+ accessUrl 会话（店面 HTML/schema，按需）。** 商品完备性以 Admin 为准。需要 HTML/schema 时，用 `shopify store info` / `shopify store open` 的 `accessUrl`。学员可以看到 access / open 流程。
4. **Opening soon 密码不进入系统。** 未登录的 `*.myshopify.com` 是密码页；`/products.json` 为 401；sitemap 常为 404。Admin 上 `onlineStore.passwordProtection.enabled` 为 true，但密码明文不可读，且 `onlineStorePasswordProtectionUpdate` 不存在。禁止设计「用 Admin 读取或设置店面密码再交给 GEO」。
5. **Theme** 仍是 `theme push --unpublished`，`previewUrl` 带 `?preview_theme_id=`。打开方式是 store open / accessUrl 会话。
6. **`accessUrl` 当会话凭证。** 文档、示例和可提交状态里不写真实 URL。dry run 中对 accessUrl 出现 429；现场限流并重试。HTML 失败时 GEO 降为 Admin-only。

---

## 2. Workshop 核心流程

```text
1. shopwright-workshop-orchestrator
   控制流程、状态和确认点

2. shopify-store-connect
   shopify store create preview --name '…' --json
   CLI 缓存 Admin token；校验 scopes；记下域名与 accessUrl 会话句柄

3. product-excel-import
   导入 5–10 个商品（默认 Draft）

4. brand-intake
   品牌资料 → Brand Brief

5. shopify-theme-builder
   骨架 + Brief → Unpublished Theme + preview_url

6. （确认）publish_products_for_geo
   商品 Active + Online Store 渠道；主题仍 Unpublished

7. shopify-geo-eval-workshop
   简化 GEO Before

8. shopify-geo-optimizer
   批 P0 + 精审 → 写回 → GEO After

9. shopwright-workshop-orchestrator
   Workshop Summary
```

学员逐步操作见 [participant-journey.md](participant-journey.md)。

---

## 3. 边界与安全规则

- 只创建并使用 **Preview Store**（`shopify store create preview`，唯一店路径）。拒绝学员自己的正式店。
- 不设 Dev Store fallback，也不课前按人数预开 Dev Store。Preview 创建失败时现场排障，必要时该组暂停并由讲师协助。
- Theme 只写 **Unpublished**。`previewUrl` 带 `?preview_theme_id=`。学员用 `shopify store open` 或 accessUrl 会话打开。
- 商品：导入默认 **Draft**；GEO 演示经确认后可 **Active + Online Store**。未登录访客仍看到 Opening soon。
- **不** Publish Theme 到 live。
- 不读取订单和客户 PII。
- 不修改 Checkout。
- 不通过 Admin 读取或设置店面密码。不把密码写入状态、技能参数或 GEO 输入。
- `accessUrl` 只在运行时会话中使用，不写入仓库。
- 所有写入操作必须有人工确认。
- GEO 使用 **Workshop 简化版**方法论，不是完整咨询服务版。

---

## 4. Skill 总览

| Skill | 类型 | 核心作用 | 是否写 Shopify |
|---|---|---|---|
| `shopwright-workshop-orchestrator` | 总控 | 流程与状态 | 否 |
| `shopify-store-connect` | 连接层 | 创建 Preview Store、校验 CLI 会话 | 可写连通性测试 Draft |
| `product-excel-import` | 数据导入 | Excel → 商品 | 是 |
| `brand-intake` | 内容理解 | → Brand Brief | 否 |
| `shopify-theme-builder` | 建站 | 骨架 → Unpublished Theme | 是 |
| `shopify-geo-eval-workshop` | 诊断 | 简化 5 维 GEO | 否（Admin 只读；按需用 accessUrl 抓 HTML） |
| `shopify-geo-optimizer` | 优化 | P0 建议写回 | 是 |

---

## 5. Skill 详细设计

### 5.1 `shopwright-workshop-orchestrator`

#### 目标

控制整场 Workshop，让参与者和讲师始终知道当前进度、当前动作和下一步。

#### 输入

```text
group_id
store_name            # 传给 store create preview --name
workshop_mode: demo | hands_on
current_step
uploaded_files
```

#### 状态文件

每个小组 `workshop-state.yaml`（schema 见 `templates/workshop-state.schema.yaml`）：

```yaml
group_id: A
store_domain: aurora-workshop.myshopify.com   # 虚构示例
mode: hands_on

connection:
  status: connected
  store_type: preview          # 固定值；Preview Store 是唯一店路径
  scopes_ok: true
  auth: cli_cached_admin_token
  storefront_session: access_url   # 句柄；文件中不写 accessUrl 原文

products:
  source_file: aurora-products.xlsx
  imported: 8
  failed: 0
  status: done
  channel_status: draft      # draft | online_store_active

brand:
  brief_file: brand-brief.json
  status: done

theme:
  theme_id: 123456
  status: unpublished
  preview_url: "https://aurora-workshop.myshopify.com/?preview_theme_id=123456"
  fallback_used: false

geo:
  evidence_mode: hybrid_admin_preview   # Admin 主；HTML 经 accessUrl 会话
  before_score: 61
  after_score: 84
  optimizer_status: approved_p0_batch

qa:
  mobile_check: pass
  product_schema: pass
  preview_open: pass
```

#### 流程

```text
start
  → create_preview_store
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

#### 人工确认点

1. 确认创建并连接 Preview Store（失败时现场排障；必要时该组暂停）
2. Excel 导入  
3. Brand Brief 锁定  
4. Theme 创建（或启用 Demo Theme Fallback）
5. **商品发布到 Online Store（GEO 前）**  
6. **批准全部 P0**（及可选精审）  
7. 最终成果生成  

#### 验收标准

- 能记录当前小组进度与 `channel_status` / `preview_url`。
- 能判断下一步；防止跳过必要确认。
- 能生成 Workshop Summary。

---

### 5.2 `shopify-store-connect`

#### 目标

为本组创建 Preview Store，确认 CLI 已缓存 Admin token，并留下 accessUrl 会话句柄。  
**主路径不是现场 OAuth，也不是课前映射表。**

#### 输入

```text
group_id
store_name          # shopify store create preview --name
# Preview 创建失败：现场重试、换店名、查 CLI/网络；必要时该组暂停
```

#### 第一版能力

```text
create_preview_store
read_store_info          # 读取域名与 accessUrl；URL 不落盘
open_store_session       # shopify store open
read_products
read_collections
read_themes
read_pages
verify_scopes
optional: write_draft_product_smoke_test
```

#### 输出示例

```json
{
  "store": "aurora-workshop.myshopify.com",
  "store_name": "Group A Aurora",
  "store_type": "preview",
  "product_count": 0,
  "auth": "cli_cached_admin_token",
  "scopes_ok": true,
  "scopes_include": ["write_products", "write_themes", "write_publications"],
  "storefront_session": "access_url",
  "password_protection_enabled": true
}
```

`password_protection_enabled` 只反映 Admin 开关。它不是密码，后续步骤不得据此去要明文。示例域名为虚构。

#### 安全边界

- 只创建 Preview Store；`store_type` 固定为 `preview`。不设 Dev Store fallback。
- 拒绝学员正式店。
- 禁止写 Online（live）Theme。
- 禁止读取客户订单。
- 禁止修改 Checkout。
- 禁止读取或更新店面密码。
- scopes 以 CLI 缓存为准，至少包含上面三个 write scope。

#### 验收标准

- **确认后约 1 分钟内**校验完成（创建本身 dry run 约 10 秒；不要求学员自助 OAuth）。
- 能读取商品和主题。
- 状态含域名与 `storefront_session=access_url`，不含密码、不含 accessUrl 字符串。
- 失败时返回可操作错误与现场排障建议（重试 `shopify store create preview`、换店名、检查 CLI/网络）；必要时暂停该组由讲师协助，不改挂 Dev Store。

---

### 5.3 `product-excel-import`

#### 目标

把简化版 Excel/CSV 导入为 Shopify 商品。  
**默认写入 Draft**；渠道发布由编排器在 GEO 前另一步确认。

#### 输入

- Excel 或 CSV（模板见 `templates/`）
- 图片 URL 或「使用预置 Demo 图」
- 字段映射配置
- 目标 Store

#### 推荐字段

核心：

```text
handle, title, description, product_type, vendor, tags,
price, compare_at_price, sku, inventory_qty, image_url, status
```

SEO / GEO：

```text
seo_title, seo_description, faq, brand, gtin, mpn,
material, color, size, google_product_category, condition
```

#### 流程

```text
上传 Excel
  → 字段识别
  → 数据校验
  → 生成导入预览
  → 参与者确认
  → 写入 Draft Products
  → 输出导入结果
```

#### 校验规则

必填：`title`, `description`, `price`, `sku`, `image_url`, `product_type`  
警告：seo_* / faq / gtin / material / color / size 缺失  
阻断：title 缺失、price 非法、image 不可访问（除非 Demo 图开关）、handle/SKU 重复  

#### 输出示例

```json
{
  "total_rows": 8,
  "ready": 7,
  "warning": 1,
  "blocked": 0,
  "imported": 7,
  "failed": 0,
  "default_status": "draft",
  "results": [
    {
      "handle": "sunscreen-gold",
      "title": "Lightweight SPF 50 Sunscreen",
      "status": "imported",
      "shopify_status": "draft",
      "shopify_product_id": "gid://shopify/Product/123"
    }
  ]
}
```

#### 验收标准

- 导入 5–10 SKU；有 ready/warning/blocked。
- 默认 `shopify_status=draft`。
- 支持 Demo 图 Fallback。

---

### 5.4 `brand-intake`

#### 目标

品牌资料 → 结构化 Brand Brief，供主题填充与 GEO 优化。

#### 输入（最少必填可跑通）

```text
品牌名称, 品牌介绍, 目标用户, 核心卖点, 品牌调性,
主色, Logo（可选）, 目标语言/币种
```

完整可选字段同 v0.1（政策、参考站、图集等）。超时可用预置 Demo Brief。

#### 输出

`brand-brief.json`（schema：`templates/brand-brief.schema.json`）。结构同 v0.1 示例（Aurora Skincare）。

#### 验收标准

- 提取名称、定位、卖点、视觉基础。
- 输出 Home / Collection / Product 页面结构意图（供骨架 sections 填充，**不是**从零生成整站）。
- 识别缺失信息；可被 theme-builder 与 optimizer 复用。

---

### 5.5 `shopify-theme-builder`

#### 目标

在**预置主题骨架**上填充 Brand Brief 与商品数据，生成可预览的 **Unpublished Theme**，返回 `preview_url`。

#### 输入

```text
brand-brief.json
products summary
store_id
skeleton_theme_ref
```

#### 输出

- Unpublished Theme（非 live）
- `preview_url`：`https://{store}/?preview_theme_id={id}`
- 已填充：Home / Collection / Product（及骨架内已有的 About/Contact/Policy）
- 基础导航与集合绑定（骨架能力范围内）
- `fallback_used` 标记

#### 流程

```text
读取 Brand Brief
  → 选择骨架
  → 填充 settings / 文案 / 色 / Logo
  → theme push --unpublished（或 Admin 等价）
  → 输出 preview_url
  → 超时则启用预置 Demo Theme preview_url
```

#### 页面最小结构

沿用骨架已实现的 Home / Collection / Product section 清单（见 v0.1）；Workshop **不**现场从零写 Liquid。

#### 验收标准

- 主题为 Unpublished；`previewUrl` 经 `shopify store open` 或 accessUrl 会话可开。
- Brand 色 / Logo / 关键文案生效（Fallback 时允许仅演示骨架品牌）。
- 移动端不崩；加购在该会话的预览里可用。
- **禁止**依赖 `shopify theme dev` 的 127.0.0.1 作为现场证据。

---

### 5.6 `shopify-geo-eval-workshop`

#### 目标与隔离

Workshop 可用的简化 GEO 诊断。回答：

1. 数据与页面能否被读懂？  
2. 商品信息是否完整？  
3. 最值得修哪些 P0？  

**与完整版 `shopify-geo-eval`（9+7 维、全站爬虫、客户 deck）隔离：**

| | 完整版 | Workshop 版 |
|---|---|---|
| Skill 名 | `shopify-geo-eval` | `shopify-geo-eval-workshop` |
| 维度 | 9+7 平铺 | **5 维** |
| 耗时 | 长 | **5–10 分钟** |
| 范围 | 全站样本 | **1 店 + 5–10 SKU** |
| 交付 | 客户报告 deck | Workshop Scorecard JSON/短页 |
| 现场 | **禁止调用** | **唯一允许** |

#### 证据策略（混合 · 已锁定）

详见 [research-preview-geo.md](research-preview-geo.md)。

- **A Admin（主）**：商品完备性、SEO、属性、媒体。Draft 阶段可预检；正式 before/after 在渠道发布后跑。
- **B accessUrl（按需）**：`shopify store info` / `shopify store open` 的会话，加上 `?preview_theme_id=`，抓 HTML/schema。429 则退避；仍失败则本轮改为 `admin_only`。
- **C Technical（降权）**：未登录 robots 200、`/products.json` 401、sitemap 常 404，标 restricted。

编排器传入 `store_domain` 与 `storefront_session=access_url` 句柄。本 skill 不接受店面密码。

**前置：** 编排器已完成「商品 Active + Online Store」确认；主题仍 Unpublished。

#### 简化版评分模型

| 维度 | 权重 | 说明 |
|---|---:|---|
| Product Data Completeness | 30% | 标题、描述、规格、属性、图片 |
| Search Findability | 25% | meta title/description、URL、品类词 |
| AI Understandability | 20% | 事实清晰、结构化、低歧义 |
| Purchase Trust | 15% | FAQ、配送退换、评价/保障、品牌 |
| Technical Visibility | 10% | sitemap/robots/schema/products.json（可降权） |

总分 100；等级 A+ 90–100 / A 80–89 / B 70–79 / C 60–69 / D <60。

#### Store / Product 检查

样本：homepage、collection、**preview** product page、导航、政策（在超时预算内）。  
每商品：`product_score`, `issues`, `priority_fixes`, `missing_fields`, `schema_status`, `seo_status`, `ai_readability_status`。

商品层权重：title 20 / description 20 / attributes 20 / SEO meta 15 / FAQ·trust 10 / structured data 10 / image·alt 5。

#### 输出

见 `templates/geo-score.schema.json`；含 `evidence_mode`、`restrictions[]`、`top_issues`、`products[]`。

#### 验收标准

- 5–10 分钟内出店总分 + 5 维 + Top Issues + 商品分 + P0/P1/P2。  
- 前后同分口径。  
- 不启动完整版 `scripts/run.py` 全站流水线。

---

### 5.7 `shopify-geo-optimizer`

#### 目标

根据 Workshop GEO 结果生成商品级建议；**默认批量批准 P0**；确认后写回；再评分。

#### 核心原则

```text
诊断来自 shopify-geo-eval-workshop
建议来自 brand brief + product data + GEO rules
写回前必须人工确认（批量 P0 算一次确认）
写回后重新评分
```

#### 现场确认 UX（v0.2 强制）

1. **批准全部 P0**（主按钮）  
2. 可选：选 1–2 个商品打开 Before/After 精审（approve / edit / ignore）  
3. P1 默认折叠；时间不够跳过  
4. 禁止默认「逐条审 8×N 条」  

#### 优化优先级

- **P0**：title, description, meta_title, meta_description, key attributes  
- **P1**：FAQ, trust, usage, materials, shipping/returns, image alt  
- **P2**：collection/homepage/nav/blog（Workshop 默认不做）  

文案约束：不夸大功效；无医疗/法律风险表述；meta 长度约 60 / 150。

#### 写回流程

```text
读商品 + GEO + Brief
  → 生成建议
  → 展示 P0 汇总 + 精审入口
  → 批 P0 / 精审
  → 写回商品字段（Admin）
  → 再跑 shopify-geo-eval-workshop
  → Before / After Score
```

#### 验收标准

- 每商品可生成 3–8 条建议；有 before/after/reason。  
- 批量 P0 一条确认可写回。  
- 写回后能重新评分并输出对比。

---

## 6. GEO 简化方法论与完整方法论的关系

完整版 `shopify-geo-eval` 继续保留在**其它仓库/skill**，用于客户诊断与正式报告。

Workshop 版裁剪见 §5.6 表。定位：

```text
不是完整咨询报告
不是正式 SEO 服务交付物
而是让参与者在短时间内看到 GEO 优化前后变化
```

---

## 7. 统一数据结构

每组中间文件：

```text
/connection.json
/products.source.xlsx
/products.import.preview.json
/products.import.result.json
/brand-brief.json
/theme.manifest.json          # 含 preview_url, fallback_used
/products.channel.json        # GEO 前发布结果
/geo.before.json
/geo.proposal.json
/geo.approved.json
/geo.after.json
/workshop-summary.md
/workshop-summary.html
/workshop-state.yaml
```

关键字段：`store_type`（固定 `preview`）, `auth`, `storefront_session`（句柄）, `preview_url`, `channel_status`, `evidence_mode`, `fallback_used`, `optimizer_status: approved_p0_batch`。不保存 `provisioned` 映射，不保存店面密码，不保存 accessUrl 原文。

---

## 8. 90 分钟 Workshop 节奏（v0.2）

| 时间 | 环节 | Skill |
|---|---|---|
| 00:00–00:10 | 开场和案例 | 无 |
| 00:10–00:15 | 创建 Preview Store | `shopify-store-connect` |
| 00:15–00:30 | 导入商品 | `product-excel-import` |
| 00:30–00:40 | Brand Brief | `brand-intake` |
| 00:40–00:55 | 骨架 Theme + 预览 | `shopify-theme-builder` |
| 00:55–00:58 | 商品发布到 Online Store | orchestrator 确认步 |
| 00:58–01:05 | GEO Before | `shopify-geo-eval-workshop` |
| 01:05–01:15 | 批 P0 + 精审 1–2 SKU | `shopify-geo-optimizer` |
| 01:15–01:30 | After + Summary | orchestrator |

详细讲师控场：[facilitator-runbook.md](facilitator-runbook.md)。

---

## 9. MVP 范围

### MVP 1：连接

```text
shopify store create preview --name '…' --json
CLI 缓存 Admin token；校验 scopes
失败则现场排障：重试/换店名/查 CLI 与网络；必要时该组暂停由讲师协助（不改挂 Dev Store）
记录域名 + storefront_session=access_url（不落 URL）
```

### MVP 2：导入商品

```text
Excel/CSV + 核心字段 + Demo 图
写 Draft
ready/warning/blocked
```

### MVP 3：Brand Brief

```text
最少必填 → 固定 JSON
缺失提示 + Demo Brief Fallback
```

### MVP 4：主题

```text
骨架填充 → Unpublished + preview_url
超时 → Demo Theme Fallback
```

### MVP 5：渠道发布（GEO 前）

```text
确认后 Active + Online Store
主题保持 Unpublished
```

### MVP 6：GEO Workshop 诊断

```text
5 维 + Top Issues + 商品分
Admin 主 + accessUrl 按需；5–10 分钟
```

### MVP 7：GEO 优化

```text
P0 批量批准
精审 1–2 SKU
写回 + 再评分
```

---

## 10. 实施节奏

### Day 1：定义接口

```text
Skill 输入输出、状态文件、Excel 模板、
Brand Brief JSON、GEO Score 结构、Preview 创建结果与 accessUrl 句柄（不保存 URL）
```

### Day 2–3：跑通单点

```text
store create preview + CLI token cache
excel import
channel publish
geo-eval-workshop
geo optimizer（批 P0）
```

### Day 4：串流程

```text
orchestrator
brand → theme skeleton
geo before → optimizer → after
```

### Day 5：Dry Run

```text
完整 Demo 品牌、5–10 SKU、
previewUrl、前后分、业务 Fallback 演练（坏 Excel / 断图 / Theme 超时）
结论写入 dry-run 笔记与 research「仍待实测」
```

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| Preview 创建失败 | 现场排障：重试 `shopify store create preview`、换店名、查 CLI/网络；必要时该组暂停由讲师协助；不改挂 Dev Store，也不课前预开 |
| Excel 不一致 | 固定模板 + 样例包 |
| 图片不可访问 | 预置 Demo 图开关 |
| Theme 太慢 | 骨架 + Demo Theme Fallback |
| Draft 无法店面评分 | GEO 前确认发布到 Online Store |
| 完整版 GEO 拖死现场 | 只允许 `shopify-geo-eval-workshop` |
| GEO 建议审不完 | 批准全部 P0 + 1–2 精审 |
| 误写学员正式店 | 只允许当次 Preview Store；不改挂 Dev Store |
| 有人把店面密码设计进 GEO | 拒绝。明文不可读，更新 mutation 不存在；店面只用 accessUrl 会话 |
| accessUrl 429 或短链过期 | 退避重试；重新 `store open` / `store info`；本轮可 Admin-only |
| 时间不够 | 每组 5–10 SKU；严格时间盒 |

---

## 12. Workshop 成功标准

每组结束时应有：

```text
1 家已连接的 Preview Store（CLI 已缓存 Admin token；唯一店路径）
5–10 个已导入商品（GEO 后多为 Active + Online Store）
1 个可预览 Unpublished Theme（previewUrl，经 store open / accessUrl 打开）
1 份 Brand Brief
1 份 GEO Before Score（workshop 口径）
1 份已批 P0 的优化摘要
1 份 GEO After Score
1 份 Workshop Summary
```

最低要求：

```text
商品导入成功
主题可以经 accessUrl 会话预览
GEO 分数有可见提升（同分口径）
参与者理解：Preview Store、access 会话、Unpublished 预览、P0 批量、渠道与 Draft 的区别
产出物里没有店面密码，也没有 accessUrl 原文
```
