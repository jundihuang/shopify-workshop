# 学员操作旅程（Participant Journey）

给**现场学员**看的一步一步说明。Agent / 讲师侧细节见各 Skill 与 [facilitator-runbook.md](facilitator-runbook.md)。

约定：每组 2–4 人；一台主操作电脑 + 共享屏幕；对话式 Agent（ShopWright）引导。一组一家店。

店面鉴权与创建命令的依据：[research-preview-geo.md](research-preview-geo.md)、[dry-run-preview-store-2026-10-30.md](dry-run-preview-store-2026-10-30.md)。

---

## 开场前（课前，学员几乎无感）

| 你看到什么 | 你做什么 | 成功画面 |
|---|---|---|
| 小组号卡片（A/B/C…）、Excel 模板、「不要连接自己的正式店」 | 记住小组号；打开讲师发的聊天 / 页面 | 知道自己是哪一组 |

不需要已有 Shopify / Partner 账号。**Preview Store 是唯一店路径**：讲师**不**预发每组一家 Dev Store，**不**设 Dev Store fallback，也**不**发 Opening soon 店面密码。店在 Step 1 现场创建。

---

## Step 0 · 开场（约 10 分钟）

| 你看到什么 | 你做什么 | 成功画面 |
|---|---|---|
| 讲师讲案例：迁移 → 建站 → GEO | 听；想本组 Demo 品牌 | 知道今天要产出：商品 + 预览店 + GEO 前后分 |

---

## Step 1 · 创建 Preview Store（约 5 分钟）

**Skill：** `shopify-store-connect`

Agent 在本组机器上执行：

```bash
shopify store create preview --name '…' --json
```

`--name` 用小组号加 Demo 品牌名。CLI 缓存 Admin API token（scopes 含 `write_products`、`write_themes`、`write_publications`）。接着 `shopify store info` 拿到店铺域名和 `accessUrl` 会话。

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| 「正在创建 Preview Store」与店名确认 | 看店名是否是本组的 | 「确认连接」 | 显示 `*.myshopify.com`、`store_type=preview`、scopes_ok=true |
| `shopify store open` / access 流程（可能弹出浏览器或访问链接） | 跟着打开，确认能看见店面而不是停在要你输入密码 | — | 会话可用；状态里只记会话句柄，不记 accessUrl 原文 |

创建失败：先按现场排障处理——重试 `shopify store create preview`、换店名、检查 CLI/网络。仍失败时该组暂停并请讲师协助；不会改挂 Dev Store，也不要在课前或现场预开 Dev Store。不要改连自己的正式店，也不要找人要店面密码。

---

## Step 2 · 导入商品（约 12–15 分钟）

**Skill：** `product-excel-import`

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| 上传区 + 模板下载 | 上传 `products` Excel/CSV（或用样例） | — | 字段识别结果 |
| 导入预览：ready / warning / blocked | 修 blocked；warning 可先忽略 | 「确认导入」 | N 个商品写入（默认 Draft） |
| 导入结果表 | 记下失败行（若有） | — | imported ≥ 5 |

图片挂了：改用模板里的 Demo 图 URL，或勾选「使用预置 Demo 图」。

---

## Step 3 · 商品上架到渠道（GEO 前，约 3 分钟）

**说明：** 纯 Draft 没有店面商品页。导入之后、Brand Brief 之前，需一次确认把商品升为 Active 并发布到 Online Store。**主题仍不发布**（这一步不依赖主题）。未登录访客仍会看到 Opening soon；本组看店面继续用 accessUrl 会话。

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| 「为 GEO 演示：发布商品到 Online Store」 | 读风险一句 | 「确认发布商品到渠道」 | 商品 status=active，渠道含 Online Store |

---

## Step 4 · Brand Brief（约 8–10 分钟）

**Skill：** `brand-intake`

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| 简表：品牌名、定位、卖点、色值、Logo | 填最少必填；可上传 Logo | 「生成 Brief」 | `brand-brief` 摘要卡片 |
| 缺失字段警告 | 可补填或「用默认值继续」 | 「确认 Brief」 | Brief 锁定，供 Theme / GEO 使用 |

---

## Step 5 · Theme 预览（约 12–15 分钟）

**Skill：** `shopify-theme-builder`

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| 「基于骨架填充主题」说明（不是从零生成） | 确认用本组 Brief | 「创建 Unpublished Theme」 | 进度条；或超时提示切 Demo Theme Fallback |
| `previewUrl`（带 `?preview_theme_id=`） | 用 **`shopify store open` 或 Step 1 的 accessUrl 会话**打开；未登录裸开会停在 Opening soon | — | Home / Collection / Product 可预览 |
| 移动端检查提示 | 快速扫一眼手机宽度 | 「预览 OK，继续」 | theme_id + unpublished 记入状态 |

失败：讲师启用预置 Demo Theme 的 `previewUrl`，本组 Brief 文案可后补。打开方式仍然是 store open / accessUrl。

---

## Step 6 · GEO 诊断 Before（约 5–7 分钟）

**Skill：** `shopify-geo-eval-workshop`（**不是**完整版客户 GEO）

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| Scorecard：总分、5 维、Top Issues、商品分 | 看 P0 列表 | — | before_score 写入状态 |
| 证据说明：Admin 主；HTML/schema 用 accessUrl 会话 | 知道未登录爬店会 401，评测不会向你要店面密码 | 「进入优化」 | — |

---

## Step 7 · GEO 优化确认（约 8–10 分钟）

**Skill：** `shopify-geo-optimizer`

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| 「批准全部 P0」大按钮 + 商品列表 | 默认点批准全部 P0 | 「批准全部 P0」 | 写回队列生成 |
| 精审区：1–2 个商品 Before/After | 可选改一条文案 | 「批准精审商品」 | 个别 edit/ignore |
| 写回进度 | 等待 | — | approved_changes 计数 |

不要逐条审完全部商品——时间不够。

---

## Step 8 · GEO After + 成果（约 8–10 分钟）

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| After Scorecard + 涨分 | 对比 before/after | — | improvement 数字 |
| Workshop Summary | 保存 / 截图 / 收邮件（若有） | 「结束本场」 | 清单打勾（见下） |

### 小组交付清单

```text
[ ] 已创建并连接 Preview Store（store_type=preview）
[ ] 5–10 个商品（Active + Online Store）
[ ] 1 个 Unpublished Theme + previewUrl（经 store open / accessUrl 打开过）
[ ] Brand Brief
[ ] GEO Before / After Score
[ ] 已批准的 P0 变更摘要
[ ] Workshop Summary
```

---

## 学员心理路径（给设计 UI 用）

```text
我不懂 Shopify，也没有 Partner 账号
  → Agent 帮我创建 Preview Store，我确认店名并跟着 store open
  → Excel 很熟，导入有预览不怕写坏
  → 商品先放到 Online Store 渠道，主题仍不发布
  → Brief 像填表，不是写代码
  → 主题是「换皮」不是「从零做站」；用 access 会话看预览
  → GEO 分数像游戏，一键修 P0 就涨分；它读的是后台数据，不问我要密码
  → 我带走 preview 链接和 Summary，知道回去怎么跟团队讲
```
