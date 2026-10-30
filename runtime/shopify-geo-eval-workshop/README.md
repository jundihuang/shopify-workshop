# shopify-geo-eval-workshop runtime

Workshop step that writes a **5-dimension GEO scorecard** for up to 10 products.
This is a workshop scorecard, not the full diagnostic.

```text
shopify-store-connect + imported products
  → shopify-geo-eval-workshop plan
  → human confirmation
  → shopify-geo-eval-workshop apply --confirm
       read Admin title / description / media / SEO fields
       optional HTML via an ephemeral store-info session
       write geo.before.json + geo.before.md
```

The scorer checks those Admin fields and applies the published weights:

| Dimension | Weight |
|---|---:|
| Product Data Completeness | 30% |
| Search Findability | 25% |
| AI Understandability | 20% |
| Purchase Trust | 15% |
| Technical Visibility | 10% |

Grades are A+ 90–100, A 80–89, B 70–79, C 60–69, D below 60.
Technical visibility stays capped because unauthenticated Preview Store
endpoints are restricted. This step does not crawl a catalog and does not
mutate products or themes.

## Requirements

- Node.js 20+ (no npm dependencies)
- `.workshop/<group_id>/connection.json` from `shopify-store-connect`
  (`store_type=preview`, `scopes_ok=true`, scopes include `read_products` or `write_products`)
- Shopify CLI on a live apply (`shopify store execute` read-only query)
- Dry-run fixture: `fixtures/admin-products.success.json`

## Commands

### Plan

```bash
./scripts/shopify-geo-eval-workshop.sh plan --group-id A
```

Reads the Preview Store connection and workshop state. Writes only:

```text
.workshop/<group_id>/geo.plan.json
```

The plan names the five dimensions, the 10-product sample cap, and whether
apply will try storefront HTML. It does not call Shopify and does not write
`geo.before.json`.

### Apply

```bash
# Human has reviewed the plan:
./scripts/shopify-geo-eval-workshop.sh apply --group-id A --confirm

# Offline rehearsal: fixture products, no Shopify, no HTML fetch.
./scripts/shopify-geo-eval-workshop.sh apply --group-id A --confirm --dry-run

# Admin fields only, even on a live Preview Store:
./scripts/shopify-geo-eval-workshop.sh apply --group-id A --confirm --skip-html
```

`apply` refuses to run without `--confirm`, including `--dry-run`.

It writes:

```text
.workshop/<group_id>/geo.before.json
.workshop/<group_id>/geo.before.md
.workshop/<group_id>/workshop-state.yaml    # geo.before_score, evidence_mode, restrictions
```

- `--dry-run` scores `fixtures/admin-products.success.json` and sets `evidence_mode=admin_only` with `html_evidence_skipped`.
- A live run reads at most 11 Admin products so the scored sample can be capped at 10.
- Storefront HTML is requested only when `products.channel_status` is `online_store_active`, the session handle is `access_url`, and neither `--dry-run` nor `--skip-html` is set.
- The session URL comes from `shopify store info` and is dropped after the request. It is not stored.
- If HTML is missing, rate-limited, or an Opening soon page, the scorecard stays `admin_only` and records a restriction.
- `preview_url` is copied only when it is `https://{store}/?preview_theme_id={id}`.

## Safety

- Preview Store only. Any other `store_type` is refused.
- No product or theme mutations. The Admin call is a read-only query without `--allow-mutations`.
- Password flags and password fields in `connection.json` are refused.
- Artifacts may contain the store domain and a safe `preview_url`. They must not contain an accessUrl, admin token, or storefront password.
- Do not call the full `shopify-geo-eval` product from this package.

## Tests

```bash
cd runtime/shopify-geo-eval-workshop && npm test
```
