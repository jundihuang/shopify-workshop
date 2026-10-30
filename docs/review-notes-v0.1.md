# ShopWright Workshop Skills 方案 — v0.1 审查笔记

审查视角：**现场陌生人 90 分钟能上手**（Workshop = 动手课，不是听 PPT）。

审查时间参考：2026-10-30（Asia/Shanghai）。

## 结论

v0.1 可作为产品蓝图，**还不能当现场操作手册**。更像 Agent 能力清单；缺学员旅程、失败 Fallback，以及 Draft / Unpublished 与公开 GEO 评分的自洽规则。

## 做得好的地方

- 只写 Dev Store / Draft / Unpublished，写入必确认——控风险方向正确。
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

「3 分钟连上 + scopes」对非开发者不现实。应默认课前预开 Dev Store + 预授权；自助 OAuth 当加分项。

→ v0.2：`shopify-store-connect` 主路径 = 选小组 / 校验预置连接。

### 4. Theme 20 分钟从零生成过满

Home/Collection/Product/About/Contact/Policy + 导航 + 移动端，LLM/API 一慢整场塌。

→ v0.2：预置主题骨架，Brief 只填文案/色/图；超时切预置 Demo Theme。

### 5. GEO 人工确认量爆表

8 商品 × 3–8 建议 = 几十条 Before/After，10 分钟审不完。

→ v0.2：一键批准全部 P0 + 1–2 商品精审；其余批量套规则。

### 6. 完整版 `shopify-geo-eval` 不能直接拿来用

完整版是 9+7 维、抓站流水线、客户报告，现场 5–10 分钟出不来。

→ v0.2 独立 skill：`shopify-geo-eval-workshop`（简化 5 维、5–10 SKU、禁止全站爬虫）。

### 7. 讲师 Runbook / Fallback 不够可执行

风险表有了，缺：小组数、店重置、坏 Excel、挂图、Theme 超时切哪套预览。

→ 已补 [facilitator-runbook.md](facilitator-runbook.md)。

## 已吸收进 v0.2 的 5 件事

1. 写清 GEO 证据源（混合模型：Admin 主 + Preview 辅 + 技术可见性降权）。
2. 学员操作旅程一页。
3. 连接 = 课前预置为主。
4. Theme = 骨架填充 + 预置 Fallback。
5. GEO 确认 = 批量 P0 + 1–2 商品精审。

## 未决（待 Dry Run）

- Dev Store 密码页下，带 `preview_theme_id` 的 HTML/schema 抓取稳定性。
- Active + Online Store 后 `/products.json` 与密码页的实际行为组合。
- 现场网络下 theme push / 图片拉取超时阈值。
