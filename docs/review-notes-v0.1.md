# ShopWright Workshop Skills 方案 — v0.1 审查笔记

> **已被后续决策覆盖的两点：**「课前按人数预开 Dev Store」和「用 Opening soon 密码抓店面」都不再是 Workshop 方案。现行架构见 [ShopWright-Workshop-Skills-方案-v0.2.md](ShopWright-Workshop-Skills-方案-v0.2.md) §1.2、[research-preview-geo.md](research-preview-geo.md)、[dry-run-preview-store-2026-10-30.md](dry-run-preview-store-2026-10-30.md)：Workshop 只保留 Preview Store 一条店路径，现场 `shopify store create preview`；不设 Dev Store fallback；GEO 店面走 `accessUrl` / `shopify store open`。下文保留为 2026-10-30 对 v0.1 的审查记录。

审查视角：**现场陌生人 90 分钟能上手**（Workshop = 动手课，不是听 PPT）。

审查时间参考：2026-10-30（Asia/Shanghai）。

## 结论

v0.1 可作为产品蓝图，**还不能当现场操作手册**。更像 Agent 能力清单；缺学员旅程、失败处理，以及 Draft / Unpublished 与公开 GEO 评分的自洽规则。

## 做得好的地方

- 只写非客户正式店、Draft、Unpublished，写入必确认——控风险方向正确。v0.1 把「非客户店」写成 Dev Store；现行主路径已改为 Preview Store（见文首）。
- 7 步流水线 + 人工确认点，与 90 分钟节奏有对应。
- MVP 切片、Dry Run、成功标准齐全。

## 会卡场的硬缺口（按严重度）

### 1. Draft 商品 + Unpublished Theme vs 公开 GEO 评分打架（方法论级）

简化 GEO 要看 sitemap、`/products.json`、公开商品页、schema。Draft 与未发布主题往往公网读不到，「优化前后分数」可能假涨或评不了。不先定证据源规则，eval / optimizer 会空转。

→ 已写入 v0.2 商品两阶段策略 + [research-preview-geo.md](research-preview-geo.md)。

### 2. 参与者界面几乎没写

七个 Skill 是后台能力；现场人是聊天跟指令、填表，还是讲师代操作？缺「每步：你看到什么 / 上传什么 / 点确认」。

→ 已补 [participant-journey.md](participant-journey.md)。

### 3. 连接店铺是最大掉队点

「3 分钟连上 + scopes」对非开发者不现实。审查当时建议课前预开 Dev Store。该建议已被 §1.2 取代：现场 `shopify store create preview`，CLI 缓存 Admin token；Preview Store 是唯一店路径，不设 Dev Store fallback。自助 OAuth 仍然不是主路径。

→ 现行：`shopify-store-connect` 主路径 = 创建 Preview Store 并校验 CLI 会话。

### 4. Theme 20 分钟从零生成过满

Home/Collection/Product/About/Contact/Policy + 导航 + 移动端，LLM/API 一慢整场塌。

→ v0.2：预置主题骨架，Brief 只填文案/色/图；超时切预置 Demo Theme。

### 5. GEO 人工确认量爆表

8 商品 × 3–8 建议 = 几十条 Before/After，10 分钟审不完。

→ v0.2：一键批准全部 P0 + 1–2 商品精审；其余批量套规则。

### 6. 完整版 `shopify-geo-eval` 不能直接拿来用

完整版是 9+7 维、抓站流水线、客户报告，现场 5–10 分钟出不来。

→ v0.2 独立 skill：`shopify-geo-eval-workshop`（简化 5 维、5–10 SKU、禁止全站爬虫）。

### 7. 讲师 Runbook / 现场排障不够可执行

风险表有了，缺：小组数、店重置、坏 Excel、挂图、Theme 超时切哪套预览。

→ 已补 [facilitator-runbook.md](facilitator-runbook.md)。

## 已吸收进 v0.2 的 5 件事

1. 写清 GEO 证据源（混合模型：Admin 主 + Preview 辅 + 技术可见性降权）。
2. 学员操作旅程一页。
3. 连接不让学员现场 OAuth。（课前预开 Dev Store 这一条已被 Preview Store 唯一店路径取代，见文首。）
4. Theme = 骨架填充 + 预置 Demo Theme Fallback。
5. GEO 确认 = 批量 P0 + 1–2 商品精审。

## 未决（dry run 之后仍开放）

密码路径已关闭：Admin 读得到 `onlineStore.passwordProtection.enabled=true`，读不到明文，且没有 `onlineStorePasswordProtectionUpdate`。GEO 不使用 Opening soon 密码。

仍待实测的是：浏览器内 `store open` 之后商品页 HTML / schema、`seo.title` 写回、accessUrl 过期后的 `store open` 恢复、429 重试，以及现场网络下 theme push / 图片拉取超时阈值。见 [dry-run-preview-store-2026-10-30.md](dry-run-preview-store-2026-10-30.md)。
