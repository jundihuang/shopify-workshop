# publish-products-for-geo runtime

Workshop Step 6 runtime: the human-confirmed GEO-prep publish step.

```text
product-excel-import (Draft only)
  → publish-products-for-geo plan
  → human confirmation
  → publish-products-for-geo apply --confirm
       productUpdate status=ACTIVE
       publishablePublish → Online Store publication
       theme untouched / never published
  → shopify-geo-eval-workshop
```

This command is deliberately separate from `product-excel-import`. The import
runtime stays Draft-only; this runtime is the only place that changes product
status and channel publication for the GEO demo.

## Requirements

- Node.js 20+ (no npm dependencies)
- `.workshop/<group_id>/connection.json` written by `shopify-store-connect`
- `store_type=preview`, `scopes_ok=true`, and scopes include
  `write_products` and `write_publications`
- Shopify CLI 5+ cached Admin auth for the Preview Store (`shopify store auth`)

## Commands

### Plan

```bash
./scripts/publish-products-for-geo.sh plan --group-id A
```

By default reads `.workshop/A/products.import.result.json` and plans only
successful imported product IDs. If that artifact is absent but the connection
is valid, it performs a read-only Admin query for up to 50 Draft products.
`--product-id` (repeatable or comma-separated) can explicitly narrow the plan.

Writes:

```text
.workshop/<group_id>/products.channel.plan.json
```

The plan includes `product_ids`, `handles`, the participant confirmation copy
「为 GEO 演示：发布商品到 Online Store（主题仍不发布）」, and a one-line risk
summary for the human confirmation UI.

### Apply

```bash
# Human has reviewed the plan:
./scripts/publish-products-for-geo.sh apply --group-id A --confirm

# Offline rehearsal: no Shopify calls; writes a fixture-backed result.
./scripts/publish-products-for-geo.sh apply --group-id A --confirm --dry-run
```

`apply` refuses to run without `--confirm` (also with `--dry-run`). For each
planned product it:

1. calls `productUpdate` with `status: ACTIVE`;
2. resolves the `Online Store` publication and calls `publishablePublish`.

It writes:

```text
.workshop/<group_id>/products.channel.json
.workshop/<group_id>/workshop-state.yaml   # products.channel_status: online_store_active
```

If any product fails, the result artifact is still written but the workshop
state is not advanced to `online_store_active` and the command exits non-zero.

## Safety boundaries

- Preview Store only; no Dev Store or production fallback.
- Requires `write_products` + `write_publications`.
- Only group import-result products or explicit `--product-id` values are
  planned; the fallback Draft query is status-limited and capped at 50.
- Never calls a theme mutation, never pushes a live theme, and records
  `theme.touched=false`, `theme.published=false`.
- Never reads or writes the storefront password.
- Never reads or persists `accessUrl`; plan/result artifacts are checked for
  credential fields before writing.
- `--dry-run` makes no network calls and writes
  `fixtures/channel-publish.success.json`-backed results.

## Tests

```bash
cd runtime/publish-products-for-geo
npm test
```

Coverage includes import-result parsing, explicit-ID narrowing, Draft fallback,
non-preview refusal, missing-scope refusal, missing-`--confirm` refusal,
dry-run artifacts, state updates, and verification that no theme mutation is
issued.
