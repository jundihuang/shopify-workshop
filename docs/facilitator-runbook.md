# 讲师 Runbook（Facilitator）

现场救命手册。学员视角见 [participant-journey.md](participant-journey.md)。  
架构依据：[research-preview-geo.md](research-preview-geo.md)、[dry-run-preview-store-2026-10-30.md](dry-run-preview-store-2026-10-30.md)。

**Preview Store 是唯一店路径。** 每组现场 `shopify store create preview`。不设 Dev Store fallback，也不课前按人数预开 Dev Store。创建失败时按现场排障处理（重试、换店名、查 CLI/网络）；必要时该组暂停并由讲师协助。

GEO 店面用 `shopify store info` / `shopify store open` 的 `accessUrl` 会话。不要收集、分发或向 Admin 查询 Opening soon 密码（明文不可读，更新 mutation 不存在）。

---

## 1. 课前（T-7 ~ T-1）

### 1.1 基础设施

| 项 | 目标 |
|---|---|
| 小组数 | 按报名定；建议 ≤ 8 组。一组一台主电脑、一家 Preview Store |
| Preview 创建 | 教室网络能跑通 `shopify store create preview --name '…' --json`（dry run 约 10s，无需学员已有账号） |
| CLI 登录 | 讲师机与学员机的 Shopify CLI 可创建 Preview Store；确认 token 会缓存在本机，且 scopes 含 `write_products`、`write_themes`、`write_publications` |
| Preview 创建排障 | 准备 2–3 个备选展示店名；现场确认 CLI 登录与教室网络可用。**不准备 Dev Store**，不改挂其他店 |
| 主题骨架 | 可一键 `theme push --unpublished` 的骨架；默认 Horizon MAIN 可留作对照 |
| Demo Fallback Theme | 全局 1 套「已填充」主题；超时组把 `previewUrl` 指到它，仍用该组的 store open / accessUrl 打开 |
| Demo 商品包 | `templates/products.sample.csv` + 可访问 Demo 图 CDN |
| Demo Brand Brief | Aurora Skincare（或当场品牌）JSON 一份 |
| Agent / 聊天入口 | 每组链接或房间；状态目录按 `group_id` 隔离。状态只存域名与会话句柄，不存 accessUrl 原文、Admin token、店面密码 |

### 1.2 Dry Run 必过清单

- [ ] `store create preview` → scopes_ok，`store info` 出现 accessUrl 字段（值不写进笔记）
- [ ] `shopify store open` 能看见店面
- [ ] 样例 CSV 导入 ≥ 5 SKU
- [ ] Brief → 骨架 Theme → `previewUrl`（`?preview_theme_id=`）在 access 会话里可开
- [ ] 商品升 Active + Online Store（`publishablePublish`）
- [ ] Workshop GEO before → 批 P0 → after 涨分可复现（Admin 主证据）
- [ ] 坏 Excel / 断图 / Theme 超时 / Preview 创建失败 四类异常演练
- [ ] 确认评测脚本没有「读取店面密码」分支

### 1.3 发给学员的课前包

- 小组号
- Excel 模板链接
- 「不要连自己的正式店」红字说明
- 一句预期：现场会创建 Preview Store，并用 CLI 的 open / access 流程看店

不要附任何 Dev Store 域名清单，也不要附店面密码；课前包只说明现场创建 Preview Store。

---

## 2. 当天开场前 30 分钟

| 检查 | 动作 |
|---|---|
| CLI | 再创建一家一次性 Preview Store，随即丢弃或留给自己演示 |
| Preview 创建排障 | 重试 `shopify store create preview` 可用；备用展示店名已列出；CLI 登录与网络正常。不要准备或改挂 Dev Store |
| 图片 CDN | curl 样例 image_url |
| Agent 健康 | 发「ping 创建 preview」 |
| 限流 | 约定组与组错开 `store open` / HTML 抓取，避免 accessUrl 429 |

---

## 3. 现场时间盒（90 分钟微调版）

| 时间 | 环节 | 讲师注意 |
|---|---|---|
| 00:00–00:10 | 开场 | 强调店是当场 Preview Store，不动学员正式店；展示最终 Summary |
| 00:10–00:15 | 创建 Preview Store | 学员可看见 `store open` / access 流程。失败时现场排障（重试/换名/查 CLI/网络）；仍失败则本组暂停由讲师协助，禁止现场教 OAuth |
| 00:15–00:30 | 导入商品 | 卡住用样例包；不要修复杂 Excel |
| 00:30–00:40 | Brand Brief | 超时「用默认 Brief」 |
| 00:40–00:55 | Theme | 超时切 Demo Theme；`previewUrl` 仍靠该组 access 会话打开 |
| 00:55–00:58 | 发布商品到渠道 | 全员统一确认；主题不发布 |
| 00:58–01:05 | GEO Before | workshop 版；Admin 主证据。禁止开完整爬虫，禁止要密码 |
| 01:05–01:15 | 批 P0 + 精审 1–2 SKU | 禁止逐条审完全部 |
| 01:15–01:30 | After + Summary + 收尾 | 拍照打卡；收集反馈。截图打码，避免把 accessUrl 拍进可公开材料 |

---

## 4. 现场排障矩阵

| 故障 | 立刻做什么 | 不要做什么 |
|---|---|---|
| `store create preview` 失败 | 现场重试命令、换展示店名、检查 CLI 登录与网络；仍失败则该组暂停，由讲师接手协助。恢复 Preview Store 后再继续 GEO | 改挂 Dev Store、课前按人数预开 Dev Store、现场为该组新开 Partner 组织、收集店面密码、改连学员正式店 |
| scopes 缺失 | 看 CLI 缓存的 authScopes；重跑 `store info` / 刷新 CLI 会话；仍缺失则暂停该组由讲师协助 | 改挂 Dev Store、现场新建 Custom App 并手填密码 |
| Excel 列乱 / 编码坏 | 发给样例 CSV，让其改 2–3 行品牌名 | 现场写脚本洗表 |
| 图片 404 | 「使用预置 Demo 图」开关 | 等学员找图床 |
| Theme push > 3–4 分钟 | 切 Demo Theme `previewUrl`；标记 theme_status=fallback | 从零再生成一整站 |
| 未登录页是 Opening soon，或 products.json 401 | 预期行为。HTML 改走 accessUrl；失败则 `admin_only` 并标 restricted | 向学员要密码，或调用不存在的密码更新 mutation |
| accessUrl 429 | 退避重试；错开组；本轮可只出 Admin 分 | 提高并发裸爬，或改走店面密码 |
| access 短链过期 | 再跑 `shopify store open` / `shopify store info` 刷新会话 | 把过期 URL 写进仓库或当密码用 |
| GEO 抓预览 HTML 失败 | 仅用 Admin 层评分；Technical Visibility 标 restricted | Publish Theme，或设计密码绕过 |
| 分数不涨 | 检查是否未批 P0 / 未写回 / 未 Active | 手工改 JSON 造假分 |
| API rate limit | 错开组；缓存 Admin read；减少并发 eval | 全组同时重跑全站 |
| 学员坚持连自己的店 | 拒绝；安全边界 | 「临时破例」 |

---

## 5. 店重置（场间 / 复训）

Preview Store 默认可丢弃。每场后：

```text
1. 确认 workshop-state、日志、截图里没有 accessUrl、Admin token、店面密码
2. 清空该 group 的 workshop-state 与中间 JSON
3. 下一场重新 shopify store create preview
4. 若某组因 Preview 创建失败而暂停：记录排障结果；下一场为该组重新执行 `shopify store create preview`，不复用 Dev Store
```

---

## 6. 话术速查

- 「我们**不发布主题**；预览链接带 `preview_theme_id`，要用 CLI 的 **store open / access** 才能看，裸开是 Opening soon。」
- 「商品为了 GEO 会放到 Online Store 渠道。未登录的人仍进不了店。我们**不使用、也不发放**店面密码。」
- 「GEO 主要读后台商品数据；页面 HTML 只在需要时走 access 会话。」
- 「GEO 是 Workshop 简化 5 维，不是完整咨询报告。」
- 「优化请点**批准全部 P0**；只要精看一两个商品。」
- 「这家店是 Preview Store，不是你的正式店。」

---

## 7. 成功标准（讲师验收）

每组最低：

```text
商品导入成功（≥5）
Preview Store 已连接（唯一店路径）
previewUrl 经 store open / accessUrl 可打开
GEO before/after 同分口径且 after ≥ before（正常批 P0 后）
全程没有人被要求提供 Opening soon 密码
学员能说出：Preview Store、access 会话看店、Unpublished 预览、P0 批量 四件事
```
