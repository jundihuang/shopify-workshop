# AGENTS.md — AI 助手执行规则（进项目先读）

本仓库服务两类用户，AI 必须先分流再行动：

## 1. 角色分流（第一步，必做）

| 用户画像 | 判别信号 | 必走路径 |
|---|---|---|
| **商家/店主**（默认假设） | "帮我开店 / 我要有自己的店 / 展示我的商品"；无 CLI/脚本/开发词汇 | [`skills/merchant-guided-setup/SKILL.md`](skills/merchant-guided-setup/SKILL.md) 的对话剧本 |
| 开发者/讲师 | 主动说出脚本名、要求跑 CLI、排障、改 runtime | README 的命令式流程 + `skills/shopwright-workshop-orchestrator/SKILL.md` |

拿不准时按**商家**处理（先问，不要先跑命令）。

## 2. 硬规则（两类用户都适用）

1. **商品数据必须先问来源**。禁止未经询问就把 `templates/products.*.sample*.csv/xlsx`
   或仓库任何示例文件当作用户数据导入。**运行时强制**：样例文件（`templates/…sample…`、
   `products.inflationwear…`）在没有 `--allow-sample` 时会被 product-excel-import 直接拒绝；
   `--allow-sample` 只能在用户明确说"用演示商品 / 示例数据"之后使用。
2. **品牌信息、banner 图、广告语同理**：先问（口述/发文件/选候选），再执行；
   商家发来的文件一律存到 `.workshop/<组>/` 下使用，不要求商家把文件放进仓库。
   **运行时强制**：brand-intake 对样例答案文件同样要求 `--allow-sample`；
   install-horizon-banner 在未传任何 `--image-*` / `--heading` / `--button-label`
   时要求 `--allow-defaults`（= 用户明确接受了默认图和默认文案），否则拒绝执行。
   产物会记录 `sample_source_used` / `defaults_used`，事后可审计。
3. 每个写操作前用大白话向用户确认（剧本里有每步的确认话术）。
4. Preview Store 是唯一店路径；主题只写 Unpublished；唯一例外是
   `install-horizon-banner`（仅改 Horizon 首页一个文件、先备份、可还原）。
5. 任何产物（JSON/报告/状态文件）不得包含 accessUrl、Admin token、店面密码。
6. 流程收尾必须交付：`workshop-summary.md` / `.html` + 一个打开即见效果的店铺
   预览链接（会话链接失效就当场用 `store-connect info` 换新）。

## 3. 快速入口

- 商家剧本：`skills/merchant-guided-setup/SKILL.md`
- 总控状态机：`skills/shopwright-workshop-orchestrator/SKILL.md`
- 八步命令示例：README.md
- 各步骤实现：`runtime/<step>/README.md`
