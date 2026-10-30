---
name: shopify-theme-builder
description: >-
  在预置主题骨架上填充 Brand Brief（色/Logo/文案），push 为 Unpublished Theme，
  返回 preview_url（?preview_theme_id=）。超时启用预置 Demo Theme。禁止 Publish Theme 与 theme dev 本地预览。
---

# shopify-theme-builder

## 何时使用

Brand Brief 已确认；需要可预览店面。

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

## 验收

- 经 `shopify store open` 或 accessUrl 会话可打开 Home / Collection / Product（未登录裸开是 Opening soon）
- Brief 色与关键文案生效（非 Fallback 时）  
- `workshop-state.theme` 已更新  
