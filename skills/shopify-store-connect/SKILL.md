---
name: shopify-store-connect
description: >-
  绑定课前预置的 Shopify Dev Store：按 group_id 解析域名与凭证，校验 scopes 与店铺只读状态。
  现场主路径不是 OAuth；失败则换备用预置店。
---

# shopify-store-connect

## 何时使用

Workshop 第一步：学员选择小组后，确认店可用。

## 主路径（v0.2）

```text
学员选择 group_id
  → 查讲师预置映射（domain + token/session）
  → verify Dev Store
  → verify_scopes
  → read_store_info（商品数、主题、password_protected）
  → 写 connection.json / 更新 workshop-state
```

**不要**把「学员现场 OAuth」当主路径。自助连接仅作加分实验，失败立即回退预置店。

## 能力清单

```text
resolve_group_store
read_store_info
read_products
read_collections
read_themes
read_pages
verify_scopes
optional: write_draft_product_smoke_test
```

## 安全边界

- `store_type` 必须为 Dev Store；否则拒绝  
- 禁止写 live/Online Theme  
- 禁止读订单 / 客户 PII  
- 禁止改 Checkout  
- 最小 scopes  

## 输出示例

```json
{
  "store": "workshop-a.myshopify.com",
  "store_name": "Workshop A",
  "password_protected": true,
  "scopes_ok": true,
  "provisioned": true,
  "product_count": 0
}
```

## 验收

- 选组后约 1 分钟内得到 `scopes_ok`  
- 失败时返回可操作错误 + 建议「请讲师分配备用店」  
