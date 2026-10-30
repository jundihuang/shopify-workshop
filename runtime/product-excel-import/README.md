# product-excel-import runtime (MVP)

Workshop Step 2 executable runtime. It parses a CSV or XLSX product sheet,
maps columns to Shopify product fields, classifies every row as
`ready` / `warning` / `blocked`, writes a reviewable preview, and imports only
human-confirmed **Draft** products into the Preview Store from
`shopify-store-connect`.

Primary demo data is the partner sample from
[INFLATION / inflationwear.com](https://inflationwear.com/collections/tshirt):

- `templates/products.inflationwear-tshirt.sample.csv`
- `templates/products.inflationwear-tshirt.sample.xlsx`
- `templates/products.inflationwear-tshirt.README.md`

`templates/products.sample.csv` remains a tiny fallback only.

- Stack: Node.js 20+ (no npm dependencies)
- Input: `.csv` or `.xlsx`
- Admin API access: Shopify CLI cached Preview Store auth via
  `shopify store execute --allow-mutations`
- Product status: always `draft`; this runtime never publishes channels
- Human confirmation: **outside** the CLI. Real imports require `--confirm`.

## Quick start

Run from the repository root after `shopify-store-connect` created
`.workshop/<group-id>/connection.json`:

```bash
# 1. Validate only. This works without a store connection.
./scripts/product-excel-import.sh validate \
  --group-id A \
  --file templates/products.inflationwear-tshirt.sample.csv

# 2. Review .workshop/A/products.import.preview.json.
#    Then, after human confirmation, import Draft products.
./scripts/product-excel-import.sh import \
  --group-id A \
  --confirm
```

End-to-end commands:

```bash
# Validate without importing (no --confirm)
./scripts/product-excel-import.sh run \
  --group-id A \
  --file templates/products.inflationwear-tshirt.sample.xlsx

# End-to-end dry path: validate + fake fixture import, no network writes
./scripts/product-excel-import.sh run \
  --group-id A \
  --file templates/products.inflationwear-tshirt.sample.csv \
  --dry-run

# End-to-end real import after confirmation
./scripts/product-excel-import.sh run \
  --group-id A \
  --file templates/products.inflationwear-tshirt.sample.csv \
  --confirm
```

Direct Node invocation is equivalent:

```bash
node runtime/product-excel-import/src/cli.js validate \
  --group-id A \
  --file templates/products.inflationwear-tshirt.sample.csv
```

## Commands and flags

| Command | Behavior |
|---|---|
| `validate` | Parses CSV/XLSX, writes `products.import.preview.json`. No Shopify calls. |
| `import` | Reads the preview and creates Draft products. Requires `--confirm` unless `--dry-run`. |
| `run` | Validates, then imports when `--confirm` is present (or when `--dry-run` is used). |
| `--dry-run` | Never invokes Shopify. Writes preview and a fake result fixture artifact. |
| `--demo-images` | Replaces missing/unreachable images with a Shopify placeholder. |
| `--check-images` | Probes image URL reachability. Off by default for offline classrooms. |
| `--file <path>` | CSV/XLSX input. Also accepts `--input` / `--source`. |
| `--workdir <dir>` | Parent workshop workspace, default `.workshop`. |
| `--group-dir <dir>` | Explicit group directory override. |
| `--preview <path>` | Alternate preview artifact for `import`. |
| `--fixtures-dir <dir>` | Alternate fixtures for dry-run import results. |
| `--confirm` | Required for a real Shopify write. Confirmation itself happens outside the CLI. |

## Artifacts

Default path: `.workshop/<group-id>/` (gitignored).

### `products.import.preview.json`

Top-level classification counts and a per-row preview:

```json
{
  "total_rows": 8,
  "ready": 0,
  "warning": 8,
  "blocked": 0,
  "importable": 8,
  "default_status": "draft",
  "field_map": {
    "title": "title",
    "price": "price",
    "sku": "sku"
  },
  "ignored_columns": ["source_url"],
  "options": {
    "demo_images": false,
    "check_images": false
  },
  "products": []
}
```

Each product includes `row_number`, `handle`, `title`, `sku`, `price`,
`status`, `issues`, and a normalized `data` payload. Source `status` values
are forced to `draft`.

### `products.import.result.json`

The import result records `imported`, `failed`, `skipped_blocked`, per-product
Shopify IDs, and safety flags:

```json
{
  "dry_run": true,
  "fake": true,
  "default_status": "draft",
  "shopify_status": "draft",
  "channels_published": false,
  "imported": 8,
  "failed": 0,
  "results": []
}
```

Dry-run results are generated from
`fixtures/product-create.success.json`; they are clearly marked `fake: true`
and are not real Shopify product IDs.

## Validation rules

Blocked:

- missing `title`, `description`, `product_type`, or `sku`
- invalid/non-positive `price`
- missing image with no `--demo-images`
- malformed image URL, or unreachable image when `--check-images` is enabled
- duplicate handle or duplicate SKU

Warning:

- missing `seo_title`, `seo_description`, `faq`, `gtin`, `material`, `color`, or `size`
- invalid `compare_at_price` / inventory value
- source status forced to `draft`
- Demo image fallback used

Unknown columns such as `source_url` are listed in `ignored_columns` and never
sent to Shopify.

## Safety

- Refuses to import when `.workshop/<group-id>/connection.json` is missing.
- Refuses any `store_type` other than `preview`.
- Requires `scopes_ok=true` with `write_products` before a write.
- Reads only the store domain/scopes from `connection.json`; it never copies
  `accessUrl`, tokens, or passwords into artifacts.
- The Admin GraphQL payload always uses `status: "DRAFT"` and contains no
  publication/channel fields.
- Artifacts are checked for sensitive field names before being written.
- `--dry-run` performs no Shopify CLI calls and no network writes.

## Shopify CLI command used

For each importable row the runtime runs two Admin GraphQL mutations through
the CLI-cached Preview Store auth:

```text
shopify store execute --store <domain> --query <productCreate> \
  --variables <json> --allow-mutations --json --no-input
shopify store execute --store <domain> --query <productVariantsBulkCreate> \
  --variables <json> --allow-mutations --json --no-input
```

If auth is missing, run `shopify store auth --store <domain>` for that Preview
Store. Do not paste a Custom App token or switch to a Dev Store.

## Tests

```bash
cd runtime/product-excel-import
npm test
```

Tests cover Inflation Wear CSV + XLSX parsing, field mapping and unknown-column
ignoring, blocked validation cases, Demo image fallback, dry-run artifact
generation, Preview Store enforcement, missing connection refusal, confirmation
gating, and accessUrl redaction.
