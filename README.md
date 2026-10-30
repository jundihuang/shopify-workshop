# shopify-workshop

Google × Beansmile **ShopWright Workshop** 文档与 Skill 包。

目标：让现场学员在约 90 分钟内，在 **Shopify Dev Store** 上完成：

1. 连接预置店铺  
2. 导入 5–10 个商品  
3. 生成 Brand Brief  
4. 填充 Unpublished Theme 并拿到 `preview_url`  
5. 用 Workshop 版 GEO 打分 → 批量确认 P0 优化 → 再打分  

本仓库是**方案与 Skill 契约**，不是完整运行时实现。实现按 `docs/` 与各 `skills/*/SKILL.md` 落地。

## 文档导航

| 文档 | 用途 |
|---|---|
| [docs/ShopWright-Workshop-Skills-方案-v0.2.md](docs/ShopWright-Workshop-Skills-方案-v0.2.md) | 主方案（v0.2 修订稿） |
| [docs/review-notes-v0.1.md](docs/review-notes-v0.1.md) | v0.1 审查结论 |
| [docs/research-preview-geo.md](docs/research-preview-geo.md) | Preview / Draft / GEO 证据调研 |
| [docs/participant-journey.md](docs/participant-journey.md) | 学员操作旅程 |
| [docs/facilitator-runbook.md](docs/facilitator-runbook.md) | 讲师 Runbook / Fallback |

## Skills（7）

```text
shopwright-workshop-orchestrator   总控与状态
shopify-store-connect              连接预置 Dev Store
product-excel-import               Excel → 商品（两阶段状态）
brand-intake                       Brand Brief
shopify-theme-builder              骨架 Theme + preview_url
shopify-geo-eval-workshop          Workshop 简化 GEO（独立于完整版）
shopify-geo-optimizer              P0 批量确认 + 写回
```

完整版客户诊断 skill `shopify-geo-eval`（9+7 维爬虫流水线）**不在本仓库**，现场禁止直接调用。

## 安全边界（硬规则）

- 只连 **Dev Store**（密码保护）
- Theme 只写 **Unpublished**，用 `?preview_theme_id=` 预览
- 不读订单 / 客户 PII，不改 Checkout
- 所有写入需人工确认
- GEO 演示前商品可升为 Active + Online Store 渠道；**不 Publish Theme**

## 快速了解证据策略

详见 [research-preview-geo.md](docs/research-preview-geo.md)。摘要：

- **否决**：纯 Draft + Unpublished Theme ≠ 可爬公开店  
- **建议**：Admin API 评数据层 + `preview_theme_id` 评主题 HTML；GEO 演示时商品 Active + Online Store，店仍带密码  
- CLI 对齐：`shopify store create dev` + `shopify theme push --unpublished` 返回的 `preview_url`

## 模板

见 `templates/`：Excel 字段说明、样例 CSV、Brand Brief / workshop-state / geo-score schema。

## 仓库状态

文档包由 Grok Bot 在 box 上生成；推送到 `https://github.com/jundihuang/shopify-workshop` 由维护者处理。
