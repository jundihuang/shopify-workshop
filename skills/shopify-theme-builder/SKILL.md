---
name: shopify-theme-builder
description: >-
  在预置主题骨架上填充 Brand Brief（色/Logo/文案），push 为 Unpublished Theme，
  返回 preview_url（?preview_theme_id=）。超时启用预置 Demo Theme。禁止 Publish Theme 与 theme dev 本地预览。
---

# shopify-theme-builder

## 何时使用

Brand Brief 已确认；需要可预览店面。现场顺序在渠道发布之后、GEO 之前。主题填充不读取渠道状态。

## 核心原则（v0.2）

```text
骨架填充，不是从零生成整站 Liquid
Unpublished only
preview_url = https://{store}/?preview_theme_id={id}
超时 → Demo Theme Fallback
不要用 shopify theme dev 的 127.0.0.1 做现场证据
```

CLI 对齐（已证实）：`shopify theme push --unpublished --json` 或 `shopify theme share`。

## 流程

```text
读 brand-brief + 商品摘要
  → 选 skeleton_theme_ref
  → 填 settings_data / sections 文案与色
  → push unpublished
  → 返回 theme_id + preview_url
  → >3–4 分钟未完成 → 挂 Demo Theme preview_url，fallback_used=true
```

## 输出（theme.manifest.json）

```json
{
  "theme_id": 123456,
  "status": "unpublished",
  "preview_url": "https://workshop-a.myshopify.com/?preview_theme_id=123456",
  "fallback_used": false,
  "pages": ["home", "collection", "product"]
}
```

## 运行时

实现位于 `runtime/shopify-theme-builder/`，入口为 `scripts/shopify-theme-builder.sh`。要求 Node.js 20+，无 npm 依赖。骨架在 `runtime/shopify-theme-builder/skeleton/`（最小 Online Store 2.0：`settings_data`、Home / Collection / Product JSON 模板，不是完整商业主题）。Demo Theme fixture 在 `templates/theme.manifest.demo.json`。

输入是 brand-intake 写下的 `.workshop/<group_id>/brand-brief.json`，以及 store-connect 写下的 `connection.json`。只接受 `store_type=preview` 且 `scopes_ok=true`、scopes 含 `write_themes`。

### 1. plan

```bash
./scripts/shopify-theme-builder.sh plan --group-id A
```

写入：

```text
.workshop/<group_id>/theme.plan.json
```

`plan` 对照 brief 列出将填入的色、Logo、文案和 sections，以及风险（缺色、`tone.avoid`、超时回退）。`participant_confirm_copy` 为 `「填充骨架并 push 为 Unpublished Theme（不发布主题，不改商品渠道）」`。不 push，不写 `theme.manifest.json`，不改 `workshop-state.yaml`。

### 2. apply（人工确认后）

人工确认留在 CLI 外面。`apply` 必须带 `--confirm`，`--dry-run` 与 `--demo` 同样要带。

```bash
# 填充骨架并上传为 Unpublished Theme
./scripts/shopify-theme-builder.sh apply --group-id A --confirm

# 不调用 Shopify CLI：用 fixture 写 manifest 与 state
./scripts/shopify-theme-builder.sh apply --group-id A --confirm --dry-run

# 不上传，直接挂文档中的 Demo Theme
./scripts/shopify-theme-builder.sh apply --group-id A --confirm --demo
```

写入：

```text
.workshop/<group_id>/theme-work/            # 填充后的骨架；--demo 不写
.workshop/<group_id>/theme.manifest.json
.workshop/<group_id>/workshop-state.yaml    # theme.* 
```

- 默认上传命令是 `shopify theme push --unpublished --json --store <domain> --path <theme-work>`。只有 `theme push --help` 不包含 `--unpublished` 时，才改用 `theme share --json`。
- CLI 返回的 preview / editor URL 不入库。`preview_url` 一律重写为 `https://{store}/?preview_theme_id={id}`。
- `--dry-run` 使用 `runtime/shopify-theme-builder/fixtures/theme-push.unpublished.success.json`，`status=unpublished`，`fallback_used=false`。
- `--demo` 使用 `templates/theme.manifest.demo.json`，`status=fallback`，`fallback_used=true`。可用 `SHOPWRIGHT_DEMO_THEME_ID` 指向该 Preview Store 上已经存在的 unpublished Demo Theme；不设置时用 fixture 里的 documented id。
- 真实上传超时（默认 3.5 分钟，`SHOPIFY_THEME_PUSH_TIMEOUT_MS` 上限 4 分钟）或失败：同样挂 Demo Theme，`fallback_reason` 为 `timeout` 或 `push_failed`。不改走别的店。
- 成功时保留 connection / products / brand / geo，只更新 `theme`。
- 若 CLI 返回的 theme role 不是 `unpublished`，不把该 id 写入 manifest，改为 Demo Theme。

## 安全边界

- 不执行 `shopify theme publish`，不传 `--live`，不用 `shopify theme dev` 或 `127.0.0.1` 做现场证据
- 不发布商品，不改 `products.channel_status`（那是 `publish-products-for-geo`）
- 不读、不写 `accessUrl`、admin token、店面密码。brief 里出现这些字段会直接拒绝；connection 里若带有 `accessUrl` 也不得进入 plan、manifest、state 或主题文件
- Preview Store 是唯一店路径

## 验收

- 经 `shopify store open` 或 accessUrl 会话可打开 Home / Collection / Product（未登录裸开是 Opening soon）
- Brief 色与关键文案生效（非 Fallback 时）
- `workshop-state.theme` 已更新（`theme_id`、`status: unpublished|fallback`、`preview_url`、`fallback_used`）
- `cd runtime/shopify-theme-builder && npm test` 覆盖：plan 不 push、无 `--confirm` 拒绝、dry-run fixture manifest、Demo Theme fallback、`preview_url` 格式、不发出 theme publish、保留 connection/products/brand、拒绝 accessUrl
