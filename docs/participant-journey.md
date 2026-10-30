# 学员操作旅程（Participant Journey）

给**现场学员**看的一步一步说明。Agent / 讲师侧细节见各 Skill 与 [facilitator-runbook.md](facilitator-runbook.md)。

约定：每组 2–4 人；一台主操作电脑 + 共享屏幕；对话式 Agent（ShopWright）引导。

---

## 开场前（课前，学员几乎无感）

| 你看到什么 | 你做什么 | 成功画面 |
|---|---|---|
| 小组号卡片（A/B/C…）与 Dev Store 域名 | 记住小组号；打开讲师发的聊天 / 页面 | 知道自己是哪一组、店是哪个 |

连接与授权由讲师课前完成。学员**不**现场跑 OAuth。

---

## Step 0 · 开场（约 10 分钟）

| 你看到什么 | 你做什么 | 成功画面 |
|---|---|---|
| 讲师讲案例：迁移 → 建站 → GEO | 听；想本组 Demo 品牌 | 知道今天要产出：商品 + 预览店 + GEO 前后分 |

---

## Step 1 · 选组并确认店铺（约 5 分钟）

**Skill：** `shopify-store-connect`

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| 「选择小组」列表 | 点本组（如 Group A） | 「确认连接」 | 显示店名、商品数、scopes_ok=true、密码店提示 |

掉队：联系讲师换备用预置店（见 Runbook）。

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

## Step 3 · Brand Brief（约 8–10 分钟）

**Skill：** `brand-intake`

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| 简表：品牌名、定位、卖点、色值、Logo | 填最少必填；可上传 Logo | 「生成 Brief」 | `brand-brief` 摘要卡片 |
| 缺失字段警告 | 可补填或「用默认值继续」 | 「确认 Brief」 | Brief 锁定，供 Theme / GEO 使用 |

---

## Step 4 · Theme 预览（约 12–15 分钟）

**Skill：** `shopify-theme-builder`

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| 「基于骨架填充主题」说明（不是从零生成） | 确认用本组 Brief | 「创建 Unpublished Theme」 | 进度条；或超时提示切 Fallback |
| `preview_url` 链接 | 打开链接；输入 Dev Store 密码（讲师公布） | — | Home / Collection / Product 可预览 |
| 移动端检查提示 | 快速扫一眼手机宽度 | 「预览 OK，继续」 | theme_id + unpublished 记入状态 |

失败：讲师启用预置 Demo Theme 的 `preview_url`，本组 Brief 文案可后补。

---

## Step 5 · 商品上架到渠道（GEO 前，约 3 分钟）

**说明：** 纯 Draft 无法做店面层 GEO。需一次确认把商品升为 Active 并发布到 Online Store；**主题仍不发布**。

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| 「为 GEO 演示：发布商品到 Online Store（店仍有密码）」 | 读风险一句 | 「确认发布商品到渠道」 | 商品 status=active，渠道含 Online Store |

---

## Step 6 · GEO 诊断 Before（约 5–7 分钟）

**Skill：** `shopify-geo-eval-workshop`（**不是**完整版客户 GEO）

| 你看到什么 | 你做什么 | 确认控件 | 成功画面 |
|---|---|---|---|
| Scorecard：总分、5 维、Top Issues、商品分 | 看 P0 列表 | — | before_score 写入状态 |
| 证据说明：Admin 主 + Preview 辅 | 理解密码店限制 | 「进入优化」 | — |

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
[ ] 已连接 Dev Store
[ ] 5–10 个商品（Active + Online Store，密码店）
[ ] 1 个 Unpublished Theme + preview_url
[ ] Brand Brief
[ ] GEO Before / After Score
[ ] 已批准的 P0 变更摘要
[ ] Workshop Summary
```

---

## 学员心理路径（给设计 UI 用）

```text
我不懂 Shopify
  → 原来店已经连好了，我只要选组
  → Excel 很熟，导入有预览不怕写坏
  → Brief 像填表，不是写代码
  → 主题是「换皮」不是「从零做站」
  → GEO 分数像游戏，一键修 P0 就涨分
  → 我带走链接和 Summary，知道回去怎么跟团队讲
```
