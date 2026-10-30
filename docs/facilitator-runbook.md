# 讲师 Runbook（Facilitator）

现场救命手册。学员视角见 [participant-journey.md](participant-journey.md)。

## 1. 课前（T-7 ~ T-1）

### 1.1 基础设施

| 项 | 目标 |
|---|---|
| 小组数 | 按报名定；建议 ≤ 8 组，每组 1 Dev Store |
| Dev Store | 每组 `shopify store create dev`；记录域名、密码、staff 账号 |
| 预授权 | App / MCP / Custom App token；scopes 最小集（见 store-connect skill） |
| 主题骨架 | 每店预装或可一键 push 的 Unpublished 骨架主题 |
| Demo Fallback Theme | 全局 1 套「已填充」主题；任意组超时可挂其 `preview_url` 演示 |
| Demo 商品包 | `templates/products.sample.csv` + 可访问 Demo 图 CDN |
| Demo Brand Brief | Aurora Skincare（或当场品牌）JSON 一份 |
| Agent / 聊天入口 | 每组链接或房间；状态目录按 `group_id` 隔离 |

### 1.2 Dry Run 必过清单

- [ ] 选组 → scopes_ok  
- [ ] 样例 CSV 导入 ≥ 5 SKU  
- [ ] Brief → 骨架 Theme → `preview_url` + 密码可开  
- [ ] 商品升 Active + Online Store  
- [ ] Workshop GEO before → 批 P0 → after 涨分可复现  
- [ ] 故意坏 Excel / 断图 / Theme 超时三条 Fallback  

### 1.3 发给学员的课前包

- 小组号与 Dev Store 密码（可开场再发密码）  
- Excel 模板链接  
- 「不要连自己的正式店」红字说明  

---

## 2. 当天开场前 30 分钟

| 检查 | 动作 |
|---|---|
| 每店可登录 | Admin + 密码页 |
| Token 未过期 | 跑一次 read_store_info |
| 图片 CDN | curl 样例 image_url |
| Agent 健康 | 发「ping 选组」 |
| 备用店 | 至少 2 个空 Dev Store |

---

## 3. 现场时间盒（90 分钟微调版）

| 时间 | 环节 | 讲师注意 |
|---|---|---|
| 00:00–00:10 | 开场 | 强调只动 Dev Store；展示最终 Summary 长什么样 |
| 00:10–00:15 | 选组连接 | **禁止**现场教 OAuth；掉队换备用店 |
| 00:15–00:30 | 导入商品 | 卡住用样例包；不要修复杂 Excel |
| 00:30–00:40 | Brand Brief | 超时「用默认 Brief」 |
| 00:40–00:55 | Theme | 超时切 Demo Theme；仍发 preview_url |
| 00:55–00:58 | 发布商品到渠道 | 全员统一确认；主题不发布 |
| 00:58–01:05 | GEO Before | 用 workshop 版；禁止开完整爬虫 |
| 01:05–01:15 | 批 P0 + 精审 1–2 SKU | 禁止逐条审完全部 |
| 01:15–01:30 | After + Summary + 收尾 | 拍照打卡；收集反馈 |

---

## 4. Fallback 矩阵

| 故障 | 立刻做什么 | 不要做什么 |
|---|---|---|
| 连接失败 / scopes 假 | 换预置备用店；更新 group→store 映射 | 现场新建 App、改正式店 |
| Excel 列乱 / 编码坏 | 发给样例 CSV，让其改 2–3 行品牌名 | 现场写脚本洗表 |
| 图片 404 | 「使用预置 Demo 图」开关 | 等学员找图床 |
| Theme push > 3–4 分钟 | 切 Demo Theme preview_url；标记 theme_status=fallback | 从零再生成一整站 |
| GEO 抓预览页失败 | 仅用 Admin 层评分；Technical Visibility 标 restricted | 改 Publish Theme 图省事 |
| 分数不涨 | 检查是否未批 P0 / 未写回 / 未 Active | 手工改 JSON 造假分 |
| API rate limit | 错开组；缓存 read；减少并发 eval | 全组同时重跑全站 |
| 学员坚持连自己的店 | 拒绝；安全边界 | 「临时破例」 |

---

## 5. 店重置（场间 / 复训）

每场后或每日：

```text
1. 删除 Workshop 标签商品或整店 reset 脚本
2. 删除 unpublished workshop themes（保留骨架模板一份）
3. 清空该 group 的 workshop-state 与中间 JSON
4. 验证 token 与密码页仍可用
```

---

## 6. 话术速查

- 「我们**不发布主题**；你打开的是带 `preview_theme_id` 的预览。」  
- 「商品为了 GEO 会放到 Online Store 渠道，但店有密码，不是正式上线。」  
- 「GEO 是 Workshop 简化 5 维，不是完整咨询报告。」  
- 「优化请点**批准全部 P0**；只要精看一两个商品。」  

---

## 7. 成功标准（讲师验收）

每组最低：

```text
商品导入成功（≥5）
preview_url 可打开（密码后）
GEO before/after 同分口径且 after ≥ before（正常批 P0 后）
学员能说出：Draft/渠道、Unpublished 预览、P0 批量 三件事
```
