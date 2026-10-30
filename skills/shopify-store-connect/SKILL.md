---
name: shopify-store-connect
description: >-
  为一组创建 Shopify Preview Store（shopify store create preview）并用 CLI 缓存的
  Admin API token 连接。校验 scopes，用 shopify store info / store open 取得 accessUrl
  会话句柄。Preview Store 是唯一店路径；不设 Dev Store fallback。不读取、不设置店面密码。
---

# shopify-store-connect

## 何时使用

Workshop 第一步：本组还没有店，需要创建 Preview Store 并确认 Admin 可用。

## 主路径

```text
确认 group_id 与展示用店名
  → shopify store create preview --name '…' --json
  → CLI 缓存 Admin API token
  → verify scopes（至少含 write_products、write_themes、write_publications）
  → shopify store info：读取店铺域名；把 accessUrl 留在 CLI 会话里
  → 可选：shopify store open（学员可见）
  → 写 connection.json / workshop-state
     只记 store_type=preview、域名、storefront_session=access_url
```

创建约 10 秒量级，不需要学员已有 Partner 账号或信用卡。

**不要**把「学员现场 OAuth」当路径，也不要课前按人数预开 Dev Store 或改挂 Dev Store。
本 skill 只创建并使用 Preview Store（`store_type=preview`）。

### 创建失败：现场排障

`shopify store create preview` 失败时按顺序处理：

1. 原命令重试一次（排除瞬时网络/CLI 错误）。
2. 换一个展示店名后重试。
3. 检查 Shopify CLI 版本与登录状态、尝试重新登录 CLI、检查教室网络/代理。
4. 仍失败则该组暂停，由讲师接手协助；恢复 Preview Store 后再继续后续步骤。

**不改挂 Dev Store，也不在课前按人数预开 Dev Store。** 不要因此去读或写 Opening soon 密码。

## 运行时

本 skill 的 Day 2–3 MVP 运行时在 `runtime/shopify-store-connect/`，用 Node 调用 Shopify CLI：

```bash
# Agent 已完成「确认创建」后，一次跑完 create → info → verify → 写安全产物
./scripts/store-connect.sh connect --group-id A --name "Group A Aurora" --mode demo

# 分步调试
./scripts/store-connect.sh create --group-id A --name "Group A Aurora"
./scripts/store-connect.sh info --group-id A
./scripts/store-connect.sh verify --group-id A
./scripts/store-connect.sh open --group-id A
```

- **人工确认留在 Agent**：CLI 不弹确认；Agent 必须先取得学员/讲师确认，再调用 `connect` 或 `create`。不要自动连跑下一组。
- `info` 只在 **stdout** 返回临时 `access_url` 给调用方；不得重定向到文件、日志、Summary 或文档。`create` / `verify` / `connect` / `open` 不输出原 URL。
- 产物固定写到 `.workshop/<group_id>/connection.json` 与 `workshop-state.yaml`；`storefront_session` 只能是句柄 `access_url`，`store_type` 只能是 `preview`，`auth` 只能是 `cli_cached_admin_token`。
- CI / 无 Shopify CLI 时用 `--dry-run`，它只消费虚构 fixtures，不调用 Shopify，不产生真实 secret。
- 重试排障：原命令重试 1 次 → 换展示店名 → 检查 `shopify version` / CLI 登录 / 网络代理。仍失败则暂停该组由讲师接手；不换 Dev Store，不要店面密码。
- Shopify CLI 版本假设：已验证 5.0.0；真实命令前会探测对应子命令是否支持 `--json`，不支持则报可操作错误，不抓取人类可读输出。详见 runtime README。

## 能力清单

```text
create_preview_store
read_store_info              # 含 accessUrl 字段；调用方不得把 URL 写入仓库或日志样例
open_store_session           # shopify store open
read_products
read_collections
read_themes
read_pages
verify_scopes
optional: write_draft_product_smoke_test
```

## 安全边界

- 只创建 Preview Store，`store_type` 固定为 `preview`。不存在其他店类型，不设 Dev Store fallback。
- 拒绝学员自己的正式店。
- 禁止写 live/Online Theme。
- 禁止读订单 / 客户 PII。
- 禁止改 Checkout。
- Admin 上 `onlineStore.passwordProtection.enabled` 可为 true。密码明文不可读，`onlineStorePasswordProtectionUpdate` 不存在。本 skill **不**实现密码读取或关闭保护。
- `accessUrl` 是会话凭证：可在进程内交给后续「打开店面 / 抓 HTML」步骤，禁止写入可提交文件、工单或文档示例。
- scopes 以 CLI 缓存为准；验收至少包含 `write_products`、`write_themes`、`write_publications`。

## 输出示例

```json
{
  "store": "aurora-workshop.myshopify.com",
  "store_name": "Group A Aurora",
  "store_type": "preview",
  "auth": "cli_cached_admin_token",
  "scopes_ok": true,
  "scopes_include": ["write_products", "write_themes", "write_publications"],
  "storefront_session": "access_url",
  "password_protection_enabled": true,
  "product_count": 0
}
```

`password_protection_enabled` 只是 Admin 上的开关回显，不是密码，也不能交给 GEO。  
示例域名是虚构的。不要把 dry run 的真实 `accessUrl` 填进这个 JSON。

## 验收

- 确认后约 1 分钟内得到 `scopes_ok`（创建本身 dry run 约 10 秒）。
- 状态里有店铺域名和 `storefront_session=access_url`，没有店面密码字段，没有 accessUrl 字符串。
- 失败时返回可操作错误与现场排障步骤（重试、换店名、查 CLI/网络）；必要时暂停该组由讲师协助，不改挂 Dev Store。
