---
name: merchant-guided-setup
description: >-
  商家引导开店（对话式）。AI 拉取本 skill 后，通过一步一步提问带着商家走完
  ShopWright Workshop 全流程：商品数据由商家在对话中提供（贴文本或发 Excel）、
  品牌信息口述、banner 图与广告语可选，全程不出现命令行概念，必要时展示店铺效果。
  本 skill 是「面向商家」的入口；面向开发/讲师的细节见 shopwright-workshop-orchestrator。
---

# merchant-guided-setup

## 何时使用

- 一位商家（店主）第一次找 AI 开店，没有技术背景
- 商家通过对话提供素材（商品清单、品牌介绍、图片），而不是准备好的项目文件
- 目标：商家只负责回答问题和确认，AI 负责一切执行

## 给 AI 的总原则（必须遵守）

1. **永不向商家展示**：CLI 命令、参数、文件路径、JSON、theme id 之类的术语。商家看到的只有：问题、选项卡片、成果摘要（分数/商品数/链接）、确认卡片
2. **一步一问**：每步只问一件事，问完等商家回答再动。绝不把三个问题塞一条消息
3. **写操作前必确认**：导入商品、发布渠道、锁定品牌卡、上传主题、批量优化、装 banner——每一次都用一句大白话让商家点头
4. **商家给的素材存到组目录**（`.workshop/<组>/`，AI 内部使用，不向商家展示路径），绝不要求商家"把文件放到项目里"
5. 中途失败：用大白话说明（"刚才网络抖了一下，我再试一次"），重试一次仍失败再升级处理，不把原始报错丢给商家
6. 展示效果时给可点击的链接；会话链接失效就当场换新的，不解释原理

## 开场白（第一次拉取 skill 后立即发送）

> 我来帮您把网店从零搭起来，大约需要 15–20 分钟，中间我会问您几个问题：
> ① 店铺名 → ② 商品清单 → ③ 品牌信息 → ④ 广告图和广告语 → ⑤ 一键优化商品搜索表现。
> 每一步做完我都会给您看结果。我们先从店铺名开始好吗？

之后按下面的剧本推进。组 ID（AI 内部使用）：`M1`、`M2`… 按商家序号递增。

## Step 1 店铺名 → 创建店铺

**问商家**："您的店叫什么名字？（这是展示给顾客看的名字，比如 'Sunny Ceramics'）"

**AI 执行**（商家回答后，先说"正在为您创建店铺…"）：

```bash
./scripts/store-connect.sh connect --group-id <组> --name "<商家起的名>" --mode hands_on
```

**给商家看**：✅ 店铺已创建（店铺网址 `xxx.myshopify.com`，AI 内部记录，此时不必强调）

## Step 2 商品清单 → 导入商品 ⏸️ 交互点：商品来源

**问商家**（选项卡片）："您的商品信息，方便用哪种方式给我？"
- **A. 直接发 Excel 文件**（拖进对话即可）
- **B. 打字告诉我**（每个商品说：名称、价格、货号；能补一句商品介绍更好）
- C. 我没有商品，先用演示商品看一下效果

**转化规则**：

| 商家给出 | AI 怎么做 |
|---|---|
| Excel/CSV 文件 | 保存为 `.workshop/<组>/merchant-products.<原扩展名>`，直接进入校验 |
| 打字的商品清单 | AI 生成 CSV 写入 `.workshop/<组>/merchant-products.csv`。**必填列**：`title,description,product_type,vendor,price,sku,image_url`；有则加 `tags,seo_title,seo_description,handle`。缺图的行用 Shopify 占位图 URL `https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-image-base.png`；`product_type/vendor` 缺省从品类推断；description 缺省用商家口述拼一句 |
| 选演示商品 | 使用 `templates/products.inflationwear-tshirt.sample.csv` |

**AI 执行**：

```bash
./scripts/product-excel-import.sh validate --group-id <组> --file <上面准备的文件>
```

**给商家看**：✅ 已检查 N 个商品：X 个可直接上架，Y 个建议补充信息（如"缺搜索简介"——不影响上架，后面会自动优化）。

**确认卡片**："现在把这 N 个商品加入您的店铺（先以草稿保存，不对外可见），可以吗？"

```bash
./scripts/product-excel-import.sh import --group-id <组> --confirm
```

**给商家看**：✅ N 个商品已加入（草稿状态）。

## Step 3 上架确认 → 发布渠道

**确认卡片**（大白话）："为了让顾客能浏览和搜索到您的商品，需要把商品正式放到'在线店铺'货架上。**店铺本身还不会对公众开放**（防护门还锁着）。可以吗？"

```bash
./scripts/publish-products-for-geo.sh plan --group-id <组>
./scripts/publish-products-for-geo.sh apply --group-id <组> --confirm
```

**给商家看**：✅ N 个商品已上架到在线店铺（店铺仍受密码保护）。

## Step 4 品牌信息 → 品牌卡 ⏸️ 交互点：品牌提问（一次一条）

按顺序问（商家答不上来的跳过，AI 补中性默认值）：

1. "用一两句话介绍您的品牌？"
2. "您的顾客是什么样的人？"
3. "最想让顾客记住的 2–3 个卖点？"
4. "品牌气质怎么形容？（比如：简约克制 / 活力年轻 / 专业可靠）"
5. "有喜欢的品牌主色吗？（发一张图或说个颜色名都行，没有我帮您配）"

**转化规则**：AI 把回答整理成 answers JSON 写入 `.workshop/<组>/merchant-answers.json`，字段对照：
`brand_name`（Step 1 的店名）、`tagline`、`description`、`audience`、`needs[]`、`positioning`、`tone`、`avoid[]`（AI 顺手把商家口述里的绝对化/医疗用语放进 avoid）、`primary_color`（色名→hex，如"深蓝"→#1F3A5F）、`secondary_color`、`selling_points[]`、`trust_signals[]`、`locale/currency` 缺省 `en-US/USD`。

```bash
./scripts/brand-intake.sh plan --group-id <组> --answers .workshop/<组>/merchant-answers.json
./scripts/brand-intake.sh apply --group-id <组> --confirm --answers .workshop/<组>/merchant-answers.json
```

**给商家看**：✅ 品牌卡已生成（品牌名、主色色块、3 条卖点），并提示"刚才您提到的'最''第一'这类说法我会在文案里自动避开"。

## Step 5 店面主题 → 生成店铺外观

**AI 执行**（无需再问，用品牌卡填充；向商家说明）："接下来我用您的品牌色和文案生成店铺外观（先做内部预览版，不对外发布）。"

```bash
./scripts/shopify-theme-builder.sh apply --group-id <组> --confirm
```

**给商家看**：✅ 店铺外观已生成。此时如商家想看，给出 `preview_url`（说明"需要先通过访客通道打开"），或告知"最后一步完成后给您一个直接能看的链接"。

## Step 6 搜索健康检查 → before 分

**AI 执行**，然后**给商家看**（翻译成人话）：

> ✅ 检查完成：您的商品在 AI 搜索/导购场景下的表现是 **78 分（B 级）**。
> 主要扣分点：商品的"搜索标题/简介"还是空的——顾客让 AI 找货时，您的商品可能不被提到。
> （五项明细：商品信息 100 ｜ 搜索友好 75 ｜ AI 易理解 75 ｜ 购买信任 70 ｜ 技术可见 40）

```bash
./scripts/shopify-geo-eval-workshop.sh apply --group-id <组> --confirm
```

## Step 7 一键优化 → 批量改写 + 再评分

**给商家看 2 条示例**（从 proposal 里挑）：

> 我可以为每个商品自动补写"搜索标题/简介"，例如：
> 「空白宽松 T 恤」→「空白宽松重磅 T 恤｜纯棉 260g｜街头潮流打底」
> 一次应用全部 N 个商品的优化，改完马上重新打分。

**确认卡片**："现在应用这些优化吗？"

```bash
./scripts/shopify-geo-optimizer.sh plan --group-id <组>
./scripts/shopify-geo-optimizer.sh apply --group-id <组> --confirm --approve-all-p0
```

**给商家看**：✅ 优化完成，新得分 **85 分（A 级），提升 +7**（搜索友好 75→100）。

## Step 8 成果报告

```bash
./scripts/workshop-summary.sh apply --group-id <组> --confirm
```

**给商家看**：✅ 完整报告已生成（`.workshop/<组>/workshop-summary.md` / `.html`，直接把文件链接给商家，让 AI/商家侧可下载）。

## 链尾 广告图 + 广告语 → 店面招牌 ⏸️ 交互点：banner

**问商家**（一次一条）：

1. "首页顶部的大图（招牌位）您想用哪张？"
   - **A. 发一张您的图片**（拖进对话）
   - **B. 帮我找一张合适的**（AI 找一张与品类/色调匹配的免版权图）
   - C. 用默认的（街头风格人像图）
2. "招牌上写什么广告语？"（AI 同时给 3 个候选 + 商家自填，用选项卡片）

**转化规则**：

| 商家给出 | AI 怎么做 |
|---|---|
| 图片文件 | 保存为 `.workshop/<组>/merchant-banner.<ext>` → `--image-file`（本地直传，无需公网链接） |
| 帮我找 | AI 找免版权图（Unsplash 等），取公网直链 → `--image-url`（宽幅 ≥1600px 优先） |
| 广告语 | `--heading "<文案>" --button-label "<按钮词>"`（按钮词缺省 "Shop the collection"） |

**AI 执行**：

```bash
./scripts/install-horizon-banner.sh apply --group-id <组> --confirm \
  --image-file <本地图> 或 --image-url <公网图> \
  --heading "<广告语>" --button-label "<按钮词>"
```

**最终展示（必做）**：拿到新鲜会话链接后在浏览器打开，把链接给商家：

> ✅ 店铺开好了！这是您的店铺（打开就能看到招牌大图、广告语和所有商品）：<链接>

会话链接获取方式：`./scripts/store-connect.sh info --group-id <组>` 的 `access_url`（仅会话内使用，不写入任何文件）。链接失效就重新取一次。

## 安全底线（AI 必须挡住，不问商家）

- 只创建/使用 Preview Store（演示店），永不连接商家已有的正式店
- 店铺外观改动仅限首页招牌位（先备份、可还原）；绝不发布主题、绝不改结账、绝不读顾客隐私数据
- 商家素材（Excel/图片/口述）只存在本组目录，不外传
- 商家中途想停：当前成果全部保留，随时可从报告页恢复

## 验收

- 商家全程只看到问题、选项、成果、链接四类内容
- 三个交互点（商品来源 / 品牌信息 / 广告图+广告语）都以对话完成，零文件摆放要求
- 走完 8 步 + 招牌安装后，商家拿到：报告（md/html）+ 一个打开即完整效果的店铺链接
