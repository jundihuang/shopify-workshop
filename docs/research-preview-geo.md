# Research: Preview Store 与 Workshop GEO 证据源

状态：**2026-10-30 dry run 已证实** Preview Store 与未登录店面行为。店面鉴权已由 owner Jayce 锁定。  
实测笔记：[dry-run-preview-store-2026-10-30.md](dry-run-preview-store-2026-10-30.md)。

早先把「Shopify CLI store create preview」收成 `shopify store create dev` + 主题预览 URL，是错的。CLI 有独立的 **Preview Store**：

```text
shopify store create preview --name '…' --json
  → type=preview，约 10s，无需已有账号 / 信用卡
  → CLI 缓存 Admin API token
  → shopify store info 含 accessUrl（会话 URL，不当文档样例保存）

shopify theme push --unpublished
  → previewUrl = https://{store}/?preview_theme_id={THEME_ID}
```

`shopify theme share` 仍是「上传为 unpublished 并给预览链接」的旁路，现场主命令用 `theme push --unpublished`。

---

## 1. Preview Store（已证实 · dry run，CLI 5.0.0）

| 事实 | 说明 |
|---|---|
| 创建 | `shopify store create preview --name '…' --json` 成功 |
| 账号 | 不需要已有 Partner 账号或信用卡 |
| Admin 写商品 | `productCreate` 的 Active 与 Draft 都成功 |
| 渠道 | `publishablePublish` 成功；Active 商品出现在 Online Store publication |
| Admin 读商品 | title / description / seo / media / publications 可读，足够做商品完备性 GEO |
| Token | CLI 缓存 Admin API token |
| Scopes | authScopes **包含** `write_products`、`write_themes`、`write_publications` |
| `shopify store info` | 返回 `accessUrl`、`saveUrl` 与上述 scopes |

**Workshop 应用（决策）：**

- 每组现场创建 **一家 Preview Store**。这是主路径。
- Workshop 不能给每位学员一家 Partner Dev Store，也不课前按人数预开 Dev Store。
- **Dev Store 只作讲师 fallback**：Preview 创建失败时，讲师挂上自己掌握的备用店。
- 拒绝学员把自己的正式店接进来。

---

## 2. 未登录店面（已证实）

| 请求 | 结果 |
|---|---|
| 浏览器打开 `*.myshopify.com` | 「Opening soon」密码页，商品正文不可见 |
| `/products.json` | **401** |
| `/sitemap.xml` | **404**（常见） |
| `robots.txt` | **200**，公开 |

Admin 字段 `onlineStore.passwordProtection.enabled` 为 **true**。这只说明保护开着。

**密码路径经 Admin API 不可行（已核实，不再设计）：**

- 店面密码 **明文不可读**。
- `onlineStorePasswordProtectionUpdate` **不存在**于这套 Admin API。
- GEO、连接 skill、编排器都不得读取、下发或写回 Opening soon 密码。

---

## 3. Theme 预览（已证实）

| 事实 | 说明 |
|---|---|
| `shopify theme pull --live` | 成功；默认 Horizon 为 MAIN，可留作对照 |
| `shopify theme push --unpublished` | 成功，返回带 `?preview_theme_id=` 的 `previewUrl` |
| `shopify theme dev` | 本地 `127.0.0.1`；logout / 会话结束后不可靠 |

未登录直接打开 `previewUrl` 仍会落到 Opening soon。学员看店面走 `shopify store open` 或 `accessUrl` 会话，再带上 `preview_theme_id`。

**产品决策：**

- 只写 **Unpublished** Theme，不 Publish Theme。
- 现场 GEO 与演示不使用 `theme dev`。

---

## 4. Draft 与渠道（已证实）

| 事实 | 说明 |
|---|---|
| Draft | 不出现在正常店面商品页 |
| Active + `publishablePublish` | 可进入 Online Store publication |
| 未登录 `/products.json` | 即使商品已在渠道上，dry run 仍是 **401** |

**硬结论：**

- 纯 Draft 做不了店面层 GEO。
- 商品完备性以 **Admin API** 为主，Draft 阶段就可以评数据层。
- 正式 before/after 仍在「Active + Online Store」之后跑，这样渠道与页面样本对齐。
- 渠道发布不等于对公网开放销售：未登录访客看到的仍是 Opening soon。

---

## 5. 明确否决

| 否决项 | 原因 |
|---|---|
| 课前为每位学员 / 每组预开一家 Partner Dev Store | Workshop 发不出这些店；Preview 创建才是主路径 |
| 把 Opening soon 密码交给 GEO | 明文不可读；没有 `onlineStorePasswordProtectionUpdate` |
| 未登录爬 `*.myshopify.com`、`/products.json`、sitemap 当主证据 | 密码页、401、404 |
| Draft + Unpublished = 可爬公开店 | Draft 不进店面；未登录 HTML 不可用 |
| 现场跑完整版 `shopify-geo-eval` | 9+7 维 + 全站抓取，5–10 分钟不可交付 |
| 用 `theme dev` 的本机 URL 作证据 | 会话结束后失效 |

---

## 6. 证据策略（决策 · owner Jayce）

| 层 | 角色 | 怎么取 | 备注 |
|---|---|---|---|
| **A. Admin API（主）** | 商品完备性、SEO 字段、属性、FAQ、媒体、publications | CLI 缓存的 Admin token | Draft 可预检；正式分在渠道发布后 |
| **B. accessUrl 会话（按需）** | 主题 HTML、JSON-LD / schema、页面结构 | `shopify store info` 的 `accessUrl`，或 `shopify store open` 会话 | 与 `?preview_theme_id=` 一起用；学员可见这条流程 |
| **C. 技术可见性（降权）** | robots / sitemap / products.json | 只记录未登录结果 | robots 200；products.json 401；sitemap 常 404。标 restricted |

`accessUrl` 按会话凭证处理：进程内使用，不写入仓库、文档示例或可提交的状态文件。本机 dry run 对 `accessUrl` 出现 **429**。现场与 CI 要限流、退避重试。HTML 抓取失败时降为 `admin_only`，标 restricted。刷新会话用再次 `shopify store info` / `shopify store open`。

### 现场两阶段

```text
阶段 1 — 导入与建站
  店：store create preview（CLI 缓存 Admin token）
  商品：Draft
  主题：Unpublished + previewUrl（?preview_theme_id=）
  可做：Admin 数据检查；学员用 store open / accessUrl 看预览

阶段 2 — GEO 演示（需确认）
  商品：Active + Online Store publication
  主题：仍 Unpublished
  证据：A 主 + B（accessUrl，按需）+ C 降权
  skill：shopify-geo-eval-workshop
```

导入时直接 Active + Online Store 仍可作为备选。MVP 保留两阶段，方便演示「确认后才对店面渠道可见」。

### 5 维与证据

| Workshop 5 维 | 主证据 | 备注 |
|---|---|---|
| Product Data Completeness 30% | A Admin | Draft 可评；dry run 简评约 20 → 75（缺图；`seo.title` 写回待核） |
| Search Findability 25% | A + 按需 B | meta 来自 Admin；页面 URL/正文需 accessUrl |
| AI Understandability 20% | A + 按需 B schema | 结构化事实走 Admin；JSON-LD 走 accessUrl |
| Purchase Trust 15% | A + 按需 B | FAQ / 政策 |
| Technical Visibility 10% | C | 未登录端点受限时可封顶 |

编排器传给 GEO 的是 **store domain** 和 **accessUrl 会话句柄**（指向当次 `store info` / `store open`），外加 `previewUrl`。没有店面密码字段。

---

## 7. 命令清单

```bash
# 现场主路径（每组一家；--name 用小组/品牌名）
shopify store create preview --name '…' --json

# 读域名与 accessUrl（URL 不入库）
shopify store info

# 学员可见的店面会话；短链过期后同样用它恢复
shopify store open

# 未发布主题
shopify theme push --unpublished
# previewUrl: https://{shop}.myshopify.com/?preview_theme_id={id}
```

讲师 fallback（仅 Preview 创建失败）：使用讲师已有的 Dev Store 连接。GEO 店面仍走该店的 `store info` / `store open` 会话，同样不读取店面密码。

---

## 8. 仍待实测

- [ ] 浏览器里 `shopify store open` 之后，商品页 HTML 与 JSON-LD 是否稳定可读
- [ ] `seo.title` 写入后读回为 null 的语义（是否回退 product title）
- [ ] 约 30 分钟预览链过期后，再次 `store open` 能否恢复 accessUrl 会话
- [ ] accessUrl **429** 在教室网络 / 多组并发下的重试间隔
- [ ] 预置骨架上 `theme push --unpublished` 的耗时
- [ ] 多组并行时 Admin API rate limit

回填到 dry-run 笔记，并同步方案里的证据策略。
