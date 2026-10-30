# Research: Shopify CLI Preview 与 Workshop GEO 证据源

状态：调研结论写入方案；**已证实** vs **建议** vs **待 Dry Run 实测** 分栏标注。

用户原话对齐：「ShopifyCLI storecreate preview」→ 官方并无单独的 “preview store” 产品；应对齐为：

```text
shopify store create dev
  + shopify theme push --unpublished [--json]
  → preview_url = https://{store}/?preview_theme_id={THEME_ID}
```

也可参考 `shopify theme share`（同样上传为 unpublished 并给预览链接）。

---

## 1. Theme 预览（已证实 · 官方文档 / CLI 行为）

| 事实 | 说明 |
|---|---|
| `shopify theme push --unpublished --json` | 返回 `preview_url`，形如 `https://store.myshopify.com/?preview_theme_id=THEME_ID` |
| `shopify theme share` | 上传为 unpublished，并给出预览链接 |
| `shopify theme dev` | 本地 `127.0.0.1` 预览；logout / 会话结束后不可靠 |
| Dev Store 创建 | `shopify store create dev`；Dev Store **永远有密码页** |
| 访客访问 | 需商店密码 / Admin 登录 / App Store demo 链接之一 |
| URL 格式（源码级确认） | `https://${store}?preview_theme_id=${theme.id}` |

**Workshop 应用结论（已证实基础上的产品决策）：**

- 使用 **Unpublished Theme** + `preview_url`（`preview_theme_id`）
- **不要**依赖 `theme dev` 的本机预览做现场 GEO
- **不要** Publish Theme（安全边界保留）

---

## 2. Draft 商品 vs 店面可见（已证实）

| 事实 | 说明 |
|---|---|
| Draft 商品 | **不会**出现在 Storefront API / 正常店面商品页 |
| 公开 `/products.json` | 只反映**已发布到销售渠道**（通常含 Online Store）的商品 |
| 密码页 | 主要挡 Online Store **HTML**；对 `/products.json` 不一定挡（行为因店配置而异，见待实测） |

**硬结论（已证实）：**

- 不能对**纯 Draft**商品做「公开店面 GEO」并指望 sitemap / products.json / 商品 HTML 齐全。
- 要对预览店面层打分，商品至少需要 **Active** 并发布到 **Online Store** 渠道；Workshop 仍使用**密码保护的 Dev Store**（未真正对公网开放销售）。

---

## 3. 明确否决

| 否决项 | 原因 |
|---|---|
| Draft + Unpublished Theme = 可爬公开店 | Draft 不进店面；未发布主题无稳定公开 HTML |
| 用完整版 `shopify-geo-eval` 现场跑 | 9+7 维 + 全站抓取，5–10 分钟不可交付 |
| 以 `theme dev` 本地 URL 作 GEO 证据 | 会话结束后失效，无法复现 |

---

## 4. 推荐 Workshop 证据策略（建议 · 待 Dry Run 实测）

### 混合证据模型

| 层 | 角色 | 证据 | 适用商品状态 |
|---|---|---|---|
| **A. Admin API（主）** | 数据完备性、SEO 字段、属性、FAQ 等 | Admin / GraphQL 商品与 metafield | Draft 也可评**数据层** |
| **B. Preview 店面（辅）** | 主题 HTML、JSON-LD / schema、页面结构 | 带密码会话抓取 `?preview_theme_id=` 页面 | 商品需 Active + Online Store 才有完整商品页 |
| **C. 技术可见性（降权）** | robots / sitemap / products.json | 公开或半公开端点 | 仅对已发布 Online Store 商品有意义；密码店可标「受限」 |

### 推荐现场流程（两阶段商品）

```text
阶段 1 — 导入与建站
  商品：Draft（或导入后暂不渠道发布）
  主题：Unpublished + preview_url
  可做：Admin 层数据检查、Theme 预览 QA

阶段 2 — GEO 演示（一键，需确认）
  商品：升为 Active + 发布到 Online Store 渠道
  主题：仍 Unpublished（不 Publish Theme）
  店：Dev Store 密码保护
  再跑：shopify-geo-eval-workshop（A 主 + B 辅 + C 降权）
```

备选：导入时直接 Active + Online Store（仍在密码 Dev Store）。MVP 更推荐两阶段，便于展示「确认后才对店面可见」。

### 评分维度与证据映射（建议）

| Workshop 5 维 | 主证据 | 备注 |
|---|---|---|
| Product Data Completeness 30% | A Admin | Draft 可评 |
| Search Findability 25% | A + 部分 B | meta 来自 Admin；URL/页文需 B |
| AI Understandability 20% | A + B schema | 结构化事实 + JSON-LD |
| Purchase Trust 15% | A + B 政策/FAQ | Brief + 页面 |
| Technical Visibility 10% | C | 密码店可封顶或标 restriction |

---

## 5. CLI / 命令清单（实施参考）

```bash
# 课前：创建 Dev Store（讲师）
shopify store create dev

# 主题：推未发布并拿预览
shopify theme push --unpublished --json
# → preview_url: https://{shop}.myshopify.com/?preview_theme_id={id}

# 或
shopify theme share
```

Workshop Agent 侧等价能力：Admin API 创建 unpublished theme / 写 asset，或包装 CLI；对外统一产出 `preview_url`。

---

## 6. 待 Dry Run 实测清单

- [ ] 带商店密码的 HTTP 客户端能否稳定抓取 `?preview_theme_id=` 的商品页 HTML 与 JSON-LD  
- [ ] Active + Online Store + 密码店时，`/products.json` 是否包含 Workshop SKU  
- [ ] sitemap 在密码 Dev Store 上的可访问性与内容完整性  
- [ ] `theme push --unpublished` 在预置骨架主题上的耗时（目标 < 3 分钟）  
- [ ] 一键「Publish products to Online Store」后 GEO before/after 是否可复现涨分  
- [ ] 多小组并行时 Admin API rate limit  

实测结果回填本文件「实测记录」小节，并更新 v0.2 → v0.3 证据策略。

## 7. 实测记录

（Dry Run 后填写）

| 日期 | 操作者 | 结论 | 影响方案条款 |
|---|---|---|---|
| — | — | — | — |
