# Dry Run：`shopify store create preview`（2026-10-30）

测试店：`ygquzh-qd.myshopify.com`（type=preview，CLI 5.0.0）

本文只记录行为与架构结论。**不收录** `accessUrl`、`saveUrl`、Admin token 或店面密码。

## 已证实

| 项 | 结果 |
|---|---|
| 创建 Preview Store | 成功，约 10s，无需已有账号/信用卡 |
| Admin 写商品 | `productCreate` Active + Draft 均成功 |
| 发布 Online Store | `publishablePublish` 成功；Active 商品出现在 Online Store publication |
| Admin 读商品做 GEO | 可行：title/description/seo/media/publications |
| Theme pull `--live` | 成功（默认 Horizon MAIN） |
| Theme push `--unpublished` | 成功，返回 `previewUrl=?preview_theme_id=…` |
| 未鉴权打开 myshopify.com | 「Opening soon」密码页，商品正文不可见 |
| 未鉴权 `/products.json` | **401** |
| 未鉴权 `/sitemap.xml` | **404** |
| `robots.txt` | 200（公开） |
| `store info` | 返回 `accessUrl`、`saveUrl`、authScopes（含 write_products/themes/publications） |

## GEO 前后（仅 Admin 规则引擎简评）

- Before（`Gold Sunscreen`）：约 **20**（标题短、描述薄、无 SEO、无图）
- After（改标题/描述/FAQ/meta description）：约 **75**（仍缺图；`seo.title` 写入后读回为 null，可能回退用 product title——待再核）

## 建议（Workshop 架构）

1. **主路径 = 每人/组 `store create preview`**，不是课前预开 Dev Store。
2. **GEO 主证据 = Admin API**（Preview 店公开爬不可靠：密码页 + products.json 401）。
3. 店面预览用 CLI `shopify store open` / `accessUrl`，不要教学员裸爬 `*.myshopify.com`。
4. Theme 用 unpublished + `preview_theme_id`；默认 MAIN 可留 Horizon 作对照。
5. 本机对 `accessUrl` 出现 **429**，现场/CI 需限流与重试；评测不要依赖高频公开抓取。

## 待实测

- 浏览器内 `store open` 后商品页 HTML / schema 是否可读
- `seo.title` 写回语义
- 30 分钟预览链过期后的 `store open` 恢复
- 现场网络下 `theme push --unpublished` 耗时（目标仍 < 3 分钟）与多组 Admin rate limit

~~Preview 店是否支持稳定密码绕过或 storefront password API~~ — 见下方决策，**不再作为待实测路径**。

## 后续决策（2026-10-30，owner Jayce）

同一轮核实补上了 Admin 密码能力，并锁定店面鉴权：

- GEO 需要店面 HTML/schema 时，走 `shopify store info` / `shopify store open` 的 **`accessUrl` 会话**。学员可以看到这条 access / open 流程。
- Admin 可读到 `onlineStore.passwordProtection.enabled = true`，但 **密码明文不可读**。
- `onlineStorePasswordProtectionUpdate` **不在**这套 Admin API 上。禁止设计「用 Admin 读取或设置 Opening soon 店面密码，再交给 GEO」。
- Dev Store 只保留为讲师 fallback（Preview 创建失败时），不按学员人数课前预开。
