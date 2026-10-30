---
name: shopify-store-connect
description: >-
  为一组创建 Shopify Preview Store（shopify store create preview）并用 CLI 缓存的
  Admin API token 连接。校验 scopes，用 shopify store info / store open 取得 accessUrl
  会话句柄。Dev Store 仅讲师 fallback。不读取、不设置店面密码。
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

**不要**把「学员现场 OAuth」或「课前按人数预开 Dev Store」当主路径。

### 讲师 fallback

`store create preview` 失败时，编排器可改挂**讲师已经持有**的 Dev Store（`store_type=dev_fallback`）。  
fallback 店同样用 `shopify store info` / `shopify store open` 取得 accessUrl 会话。  
不要因此去读或写 Opening soon 密码。

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

- 主路径 `store_type=preview`。`dev_fallback` 只能由讲师显式指定。
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
- 失败时返回可操作错误 + 建议「请讲师改挂 fallback Dev Store」。
