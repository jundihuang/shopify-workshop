# ShopWright Workshop Skills 方案 v0.2

> 修订自 v0.1。审查笔记：[review-notes-v0.1.md](review-notes-v0.1.md)  
> Preview / Draft / GEO 调研：[research-preview-geo.md](research-preview-geo.md)  
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

### 1.1 v0.2 相对 v0.1 关键变更

1. **商品两阶段**：导入默认 Draft；GEO 前确认后 Active + Online Store（店仍密码）；否决「纯 Draft 做公开店面 GEO」。
2. **Theme**：预置骨架填充 + Fallback Demo Theme；`preview_url`（`preview_theme_id`）；不 Publish Theme；不用 `theme dev` 本地预览。
3. **连接**：课前预置 Dev Store + 预授权为主；现场只选组校验。
4. **GEO**：独立 `shopify-geo-eval-workshop`（5 维、5–10 SKU、5–10 分钟）；禁止调用完整版爬虫流水线。
5. **证据**：混合模型 Admin 主 + Preview 辅 + Technical 降权（见 research）。
6. **确认**：GEO「批准全部 P0」+ 1–2 商品精审。
7. **文档**：补学员旅程、讲师 Runbook、调研结论。
8. **节奏**：连接缩短；Theme 缩短；插入「发布商品到渠道」；GEO 时间盒收紧。

---

## 2. Workshop 核心流程

```text
1. shopwright-workshop-orchestrator
   控制流程、状态和确认点

2. shopify-store-connect
   选预置小组 Dev Store，校验权限与店铺状态（非现场 OAuth）

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

- 只连接 **Shopify Dev Store**（课前预置）。
- Theme 只写 **Unpublished**；预览仅 `?preview_theme_id=`。
- 商品：导入默认 **Draft**；GEO 演示经确认后可 **Active + Online Store**；**不**等于正式开业（密码页仍在）。
- **不** Publish Theme 到 live。
- 不读取订单和客户 PII。
- 不修改 Checkout。
- 所有写入操作必须有人工确认。
- GEO 使用 **Workshop 简化版**方法论，不是完整咨询服务版。

---

## 4. Skill 总览

| Skill | 类型 | 核心作用 | 是否写 Shopify |
|---|---|---|---|
| `shopwright-workshop-orchestrator` | 总控 | 流程与状态 | 否 |
| `shopify-store-connect` | 连接层 | 选组、校验预置连接 | 可写连通性测试 Draft |
| `product-excel-import` | 数据导入 | Excel → 商品 | 是 |
| `brand-intake` | 内容理解 | → Brand Brief | 否 |
| `shopify-theme-builder` | 建站 | 骨架 → Unpublished Theme | 是 |
| `shopify-geo-eval-workshop` | 诊断 | 简化 5 维 GEO | 否（只读 + 抓预览） |
| `shopify-geo-optimizer` | 优化 | P0 建议写回 | 是 |

---

## 5. Skill 详细设计

### 5.1 `shopwright-workshop-orchestrator`

#### 目标

控制整场 Workshop，让参与者和讲师始终知道当前进度、当前动作和下一步。

#### 输入

```text
group_id
store_domain          # 来自预置映射
workshop_mode: demo | hands_on
current_step
uploaded_files
```

#### 状态文件

每个小组 `workshop-state.yaml`（schema 见 `templates/workshop-state.schema.yaml`）：

```yaml
group_id: A
store_domain: workshop-a.myshopify.com
mode: hands_on

connection:
  status: connected
  scopes_ok: true
  provisioned: true          # v0.2：课前预置

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
  preview_url: "https://workshop-a.myshopify.com/?preview_theme_id=123456"
  fallback_used: false

geo:
  evidence_mode: hybrid_admin_preview
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
  → select_provisioned_store
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

1. 选组 / 确认预置连接  
2. Excel 导入  
3. Brand Brief 锁定  
4. Theme 创建（或启用 Fallback）  
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

绑定课前预置的 Dev Store，确认店铺状态与权限。  
**主路径不是现场 OAuth。**

#### 输入

```text
group_id
# store_domain / token 来自讲师预置映射表
store_type: dev_store   # 非 dev 则拒绝
```

#### 第一版能力

```text
resolve_group_store
read_store_info
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
  "store": "workshop-a.myshopify.com",
  "store_name": "Workshop A",
  "plan": "staff",
  "product_count": 3,
  "password_protected": true,
  "scopes_ok": true,
  "provisioned": true
}
```

#### 安全边界

- 只允许 Dev Store。
- 禁止写 Online（live）Theme。
- 禁止读取客户订单。
- 禁止修改 Checkout。
- 只使用课前申请的最小权限。

#### 验收标准

- **选组后 1 分钟内**校验完成（不再要求学员 3 分钟自助 OAuth）。
- 能读取商品和主题。
- 失败时编排器提示换备用预置店。

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

- 主题为 Unpublished；`preview_url` 在 Dev Store 密码后可开。
- Brand 色 / Logo / 关键文案生效（Fallback 时允许仅演示骨架品牌）。
- 移动端不崩；加购在预览中可用（密码店限制下）。
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

#### 证据策略（混合 · 建议）

详见 [research-preview-geo.md](research-preview-geo.md)。

- **A Admin（主）**：字段完备性；Draft 阶段也可预检，正式 before/after 在渠道发布后跑。  
- **B Preview（辅）**：`preview_theme_id` + 密码会话抓 HTML/schema。  
- **C Technical（降权）**：robots/sitemap/products.json；密码店可标 restricted。  

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

关键字段相对 v0.1 增加：`provisioned`, `preview_url`, `channel_status`, `evidence_mode`, `fallback_used`, `optimizer_status: approved_p0_batch`。

---

## 8. 90 分钟 Workshop 节奏（v0.2）

| 时间 | 环节 | Skill |
|---|---|---|
| 00:00–00:10 | 开场和案例 | 无 |
| 00:10–00:15 | 选组确认预置店 | `shopify-store-connect` |
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
预置映射选组
校验 scopes / Dev Store
失败换备用店
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
混合证据；5–10 分钟
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
Brand Brief JSON、GEO Score 结构、预置店映射格式
```

### Day 2–3：跑通单点

```text
store connect（预置）
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
preview_url、前后分、Fallback 演练
回填 research「实测记录」
```

---

## 11. 风险与对策

| 风险 | 对策 |
|---|---|
| 现场授权失败 | **课前** Dev Store + 授权；备用店 |
| Excel 不一致 | 固定模板 + 样例包 |
| 图片不可访问 | 预置 Demo 图开关 |
| Theme 太慢 | 骨架 + Demo Theme Fallback |
| Draft 无法店面评分 | GEO 前确认发布到 Online Store |
| 完整版 GEO 拖死现场 | 只允许 `shopify-geo-eval-workshop` |
| GEO 建议审不完 | 批准全部 P0 + 1–2 精审 |
| 误写线上店 | 只允许 Dev Store；拒绝非 dev |
| 时间不够 | 每组 5–10 SKU；严格时间盒 |

---

## 12. Workshop 成功标准

每组结束时应有：

```text
1 个已连接的预置 Shopify Dev Store
5–10 个已导入商品（GEO 后多为 Active + Online Store）
1 个可预览 Unpublished Theme（preview_url）
1 份 Brand Brief
1 份 GEO Before Score（workshop 口径）
1 份已批 P0 的优化摘要
1 份 GEO After Score
1 份 Workshop Summary
```

最低要求：

```text
商品导入成功
主题可以预览（密码后）
GEO 分数有可见提升（同分口径）
参与者理解：预置店、Unpublished 预览、P0 批量、渠道与 Draft 区别
```
