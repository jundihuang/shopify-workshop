# shopify-workshop

Google × Beansmile **ShopWright Workshop** —— AI 引导商家开店的文档与 Skill 包。

**本仓库只有一种使用方式：AI 通过 [`merchant-guided-setup`](skills/merchant-guided-setup/SKILL.md) 剧本，一步一步与用户对话完成开店。** 没有"命令式直跑"模式；无论谁来用（商家、讲师、维护者），流程都必须以询问式进行。

> ## ⚠️ AI 助手执行规则（先读 [AGENTS.md](AGENTS.md)）
>
> 1. **每个素材都必须先问用户**：商品数据来源（用户发 Excel / 打字报商品 / 明确选择演示数据）、
>    品牌信息（口述）、banner 图与广告语（发图 / 选候选 / 明确接受默认）。
> 2. **运行时硬门强制**：仓库内置样例（`templates/…sample…`、`products.inflationwear…`）不带
>    `--allow-sample` 会被直接拒绝；banner 不带任何用户图/文案参数且无 `--allow-defaults`
>    同样被拒绝。这些 flag 只能在用户**明确选择**后使用，产物会记录
>    `sample_source_used` / `defaults_used` 供审计。
> 3. 每个写操作前用大白话向用户确认；收尾交付 `workshop-summary.md` / `.html` + 店铺预览链接。
> 4. 安全底线：只用 Preview Store（现场创建的演示店）、主题不发布、不碰顾客隐私；
>    唯一例外是链尾把 banner 装进 Horizon 首页（单文件、先备份、可还原）。

## 商家旅程（AI 与用户的一问一答）

全部素材在对话中收集，用户发来的文件由 AI 存到 `.workshop/<组>/` 使用，**不要求用户把文件放进仓库**。

| 步骤 | AI 问用户 | 用户答 | AI 做（内部） | 展示给用户 |
|---|---|---|---|---|
| 1 开店 | "店叫什么名字？" | 口述店名 | 创建全新 Preview Store、校验权限 | ✅ 店铺已创建 |
| **2 商品** ⏸️ | "**商品数据从哪里来？** 发 Excel / 打字告诉我 / 用演示商品" | 发文件 / 报清单 / 选演示 | 校验清单（缺什么会提示），确认后导入为**草稿**（不对外可见） | ✅ N 个商品已加入（校验结果） |
| 3 上架 | "把商品放到在线店铺货架上（店铺仍受密码保护），可以吗？" | 确认 | 商品 Active + Online Store 渠道；**主题不发布** | ✅ N 个商品已上架 |
| **4 品牌** ⏸️ | "介绍下品牌？顾客是谁？卖点？气质？主色？"（一问一答） | 口述 | 整理成品牌卡（自动拦截"最/第一/治愈"等违规说法） | ✅ 品牌卡（名称、主色、卖点） |
| 5 店面 | 无需新素材 | — | 用品牌色和文案生成店铺外观（**不发布**） | ✅ 外观已生成 |
| 6 体检 | 无需新素材 | — | 按商品搜索友好度打分（5 维） | 📊 当前得分（如 78/B，扣分点白话解释） |
| 7 优化 | "为每个商品补写搜索标题/简介（展示 2 条样例），现在应用吗？" | 确认 | 批量优化 + 重新打分 | 📊 新得分（如 85/A，+7） |
| 8 报告 | 无需新素材 | — | 汇总全程 | 📄 `workshop-summary.md` / `.html` |
| 链尾 招牌 ⏸️ | "**首页大图用哪张？**（发图 / 帮我找 / 用默认）" + "**广告语写什么？**（候选/自拟）" | 发图/选择/口述 | banner 图+文案装进 Horizon 首页（先备份） | 🔗 **店铺链接**：打开即见招牌+商品 |

⏸️ = 必停询问点（运行时硬门兜底：AI 不问就执行不下去）。

**最终交付**：`workshop-summary.md` / `workshop-summary.html`（全程报告）+ 一个打开就能看到招牌、广告语和全部商品的店铺链接。

## 交付物清单（每组 `.workshop/<组>/`）

`connection.json`（店铺）、`products.import.*`（商品）、`products.channel.json`（上架）、`brand-brief.json`（品牌卡）、`theme.manifest.json`（外观）、`geo.before/after.*`（打分）、`geo.proposal/approved.*`（优化记录）、`workshop-summary.md/html/json`（报告）、`banner.install.json` + `horizon-index.backup.json`（招牌 + 备份）、`workshop-state.yaml`（全程状态）。

## 内部实现（维护者参考，用户无需了解）

每步是一个独立 runtime（Node 20+，零 npm 依赖，入口 `scripts/<step>.sh`，细节见各目录 README）：

| 步骤 | Runtime | 硬门（防"未询问就执行"） |
|---|---|---|
| 1 | [shopify-store-connect](runtime/shopify-store-connect/) | —（只创建演示店） |
| 2 | [product-excel-import](runtime/product-excel-import/) | 样例表必须 `--allow-sample` |
| 3 | [publish-products-for-geo](runtime/publish-products-for-geo/) | 必须 `--confirm` |
| 4 | [brand-intake](runtime/brand-intake/) | 样例答案必须 `--allow-sample` |
| 5 | [shopify-theme-builder](runtime/shopify-theme-builder/) | 必须 `--confirm`（不发布主题） |
| 6 | [shopify-geo-eval-workshop](runtime/shopify-geo-eval-workshop/) | 必须 `--confirm`（只读打分） |
| 7 | [shopify-geo-optimizer](runtime/shopify-geo-optimizer/) | 必须 `--confirm --approve-all-p0` |
| 8 | [workshop-summary](runtime/workshop-summary/) | 必须 `--confirm`（不调 Shopify） |
| 链尾 | [install-horizon-banner](runtime/install-horizon-banner/) | 无用户图/文案时必须 `--allow-defaults` |

主题骨架（自带 banner）在 [runtime/shopify-theme-builder/skeleton](runtime/shopify-theme-builder/skeleton/)；总控状态机契约见 [skills/shopwright-workshop-orchestrator](skills/shopwright-workshop-orchestrator/SKILL.md)；各 runtime 的 plan/apply/restore 命令细节见各自 README。完整版客户诊断 skill `shopify-geo-eval`（9+7 维爬虫）**不在本仓库**，禁止调用。

## 安全边界（硬规则）

- **Preview Store 是唯一店路径**（现场创建的演示店）；不连接任何正式店，不改挂 Dev Store
- 主题只写 **Unpublished**；不发布主题、不改结账、不读订单/顾客隐私
- 不读取、不设置店面密码；任何产物不含 accessUrl / Admin token / 密码
- 所有写入经用户确认；样例数据与默认素材仅在用户明确选择后使用（留痕可审计）
- 唯一 live 主题例外：`install-horizon-banner` 仅改 Horizon 首页 `templates/index.json` 一个文件，改前备份、`restore` 一键还原

## 文档导航

| 文档 | 用途 |
|---|---|
| [AGENTS.md](AGENTS.md) | AI 执行规则（询问式、硬门、安全） |
| [skills/merchant-guided-setup](skills/merchant-guided-setup/SKILL.md) | AI 对话剧本（唯一入口） |
| [docs/ShopWright-Workshop-Skills-方案-v0.2.md](docs/ShopWright-Workshop-Skills-方案-v0.2.md) | 主方案（v0.2 修订稿） |
| [docs/research-preview-geo.md](docs/research-preview-geo.md) | Preview Store / accessUrl / GEO 证据 |
| [docs/participant-journey.md](docs/participant-journey.md) | 学员操作旅程 |
| [docs/facilitator-runbook.md](docs/facilitator-runbook.md) | 讲师 Runbook / 现场排障 |

## 模板与样例

`templates/`：商品表字段说明、Brand Brief schema、[Demo Brief（Aurora Skincare）](templates/brand-brief.demo.aurora-skincare.json)、[答案样例](templates/brand-intake.answers.sample.json)（**仅供用户明确选择演示时使用**）、workshop-state / geo-score schema。商品样例来自合作伙伴 [INFLATION / inflationwear.com](https://inflationwear.com/collections/tshirt)（8 SKU，授权说明见 [templates/products.inflationwear-tshirt.README.md](templates/products.inflationwear-tshirt.README.md)）。

## 仓库状态

文档包由 Grok Bot 在 box 上生成；推送到 `https://github.com/jundihuang/shopify-workshop` 由维护者处理。
