# AGENTS.md — AI 助手执行规则（进项目先读）

本仓库只有一种工作方式：**AI 通过对话一步一步引导用户完成开店**。
没有"命令式直跑"模式——无论用户是谁（商家、讲师、维护者），流程都以询问式进行。

## 1. 唯一入口

任何"开店 / 走流程 / 建店"请求 → 先读
[`skills/merchant-guided-setup/SKILL.md`](skills/merchant-guided-setup/SKILL.md)
并严格按照该剧本**一步一步交互式**执行。拿不准时先问，不要先跑命令。

## 2. 硬规则（运行时强制，AI 不可绕过）

1. **商品数据必须先问来源**（用户发 Excel/CSV、打字报商品、或明确选择演示数据）。
   内置样例（`templates/…sample…`、`products.inflationwear…`）在没有 `--allow-sample`
   时会被 product-excel-import **直接拒绝**；`--allow-sample` 只能在用户明确选择
   演示数据之后使用，产物记录 `sample_source_used`。
2. **品牌信息必须先问**（介绍、顾客、卖点、气质、主色，口述即可）。样例答案文件同样
   需要 `--allow-sample`；AI 把用户口述整理成 `.workshop/<组>/merchant-answers.json`。
3. **banner 图与广告语必须先问**（用户发图 / AI 找图给用户挑 / 用户明确接受默认）。
   install-horizon-banner 在没有任何 `--image-*` / `--heading` / `--button-label` 时
   需要 `--allow-defaults`，否则**直接拒绝**；结果记录 `defaults_used`。
4. **每个写操作前用大白话确认**（剧本里有每步的确认话术）。
5. 用户发来的文件（Excel / 图片 / 答案）一律存到 `.workshop/<组>/` 使用，
   **不要求用户把文件放进仓库**。
6. 安全底线：只用 Preview Store（现场创建的演示店）；主题只写 Unpublished；
   唯一 live 例外是 `install-horizon-banner`（仅改 Horizon 首页一个文件、先备份、可还原）。
   任何产物不得包含 accessUrl、Admin token、店面密码。
7. **收尾必须交付**：`workshop-summary.md` / `.html` + 一个打开即见效果的店铺预览链接
   （会话链接失效就当场用 `store-connect info` 换新）。

## 3. 快速入口

- 对话剧本（唯一入口）：`skills/merchant-guided-setup/SKILL.md`
- 总控状态机（内部参考）：`skills/shopwright-workshop-orchestrator/SKILL.md`
- 商家旅程总览：README.md
- 各步骤实现与命令细节：`runtime/<step>/README.md`
