# shopify-theme-builder runtime

Workshop step that fills a small Online Store 2.0 skeleton from `brand-brief.json`
and uploads it as an **unpublished** theme.

```text
brand-intake (brand-brief.json) + shopify-store-connect (connection.json)
  → shopify-theme-builder plan
  → human confirmation
  → shopify-theme-builder apply --confirm
       fill skeleton settings / section copy
       shopify theme push --unpublished --json
       write theme.manifest.json + theme.preview_url
```

Workshop chain: channel publish, then brand-intake, then this step, then GEO.
This runtime requires `brand-brief.json` and does not require products to be
published. It does not generate a Liquid theme from scratch, does not publish
the live theme, and does not change product status or sales channels.

## Requirements

- Node.js 20+ (no npm dependencies)
- `.workshop/<group_id>/connection.json` from `shopify-store-connect`
  (`store_type=preview`, `scopes_ok=true`, scopes include `write_themes`)
- `.workshop/<group_id>/brand-brief.json` from `brand-intake`
- Shopify CLI on a real apply (`shopify theme push --unpublished --json`)
- Skeleton: `runtime/shopify-theme-builder/skeleton/`
- Demo Theme fixture: `templates/theme.manifest.demo.json`

## Commands

### Plan

```bash
./scripts/shopify-theme-builder.sh plan --group-id A
```

Reads the brief and the Preview Store connection. Writes only:

```text
.workshop/<group_id>/theme.plan.json
```

The plan lists the colors, logo, and Home / Collection / Product copy that
apply will write, plus risks (missing color, `tone.avoid`, timeout fallback).
It does not call the Shopify CLI and does not change `workshop-state.yaml`.

### Apply

```bash
# Human has reviewed the plan:
./scripts/shopify-theme-builder.sh apply --group-id A --confirm

# Offline rehearsal: no Shopify CLI calls; fixture manifest + filled skeleton.
./scripts/shopify-theme-builder.sh apply --group-id A --confirm --dry-run

# Skip the upload and attach the documented Demo Theme.
./scripts/shopify-theme-builder.sh apply --group-id A --confirm --demo
```

`apply` refuses to run without `--confirm`, including `--dry-run` and `--demo`.

It writes:

```text
.workshop/<group_id>/theme-work/             # filled skeleton; omitted for --demo
.workshop/<group_id>/theme.manifest.json
.workshop/<group_id>/workshop-state.yaml     # theme.theme_id, status, preview_url, fallback_used
```

`preview_url` is always `https://{store}/?preview_theme_id={id}`. A CLI preview
URL, editor URL, localhost `theme dev` URL, or password query is never stored.

`--dry-run` uses `fixtures/theme-push.unpublished.success.json` and sets
`status=unpublished`, `fallback_used=false`.

## Demo Theme fallback

`--demo`, a push that exits non-zero, or a push that exceeds the timeout
attaches the documented Demo Theme:

- fixture: `templates/theme.manifest.demo.json`
- `status=fallback`
- `fallback_used=true`
- `preview_url` rewritten onto the connected Preview Store

The default timeout is 3.5 minutes. `SHOPIFY_THEME_PUSH_TIMEOUT_MS` can lower
it; values above 4 minutes are capped. Set `SHOPWRIGHT_DEMO_THEME_ID` when a
facilitator has already pushed that unpublished demo theme to the Preview
Store. Without it, the manifest keeps the documented fixture id. This path
does not publish a theme and does not switch stores.

`theme share --json` is used only when `shopify theme push --help` does not
advertise `--unpublished`. Push is preferred.

## Safety boundaries

- Preview Store only. No Dev Store and no other store path.
- Never runs `shopify theme publish`, never passes `--live`, and never runs
  `shopify theme dev`.
- A theme role other than `unpublished` is not recorded; apply attaches the
  Demo Theme instead.
- Does not publish products or change `products.channel_status`.
- Never reads or writes `accessUrl`, admin tokens, or the storefront password.
  A brand brief that contains those fields is refused before a manifest is written.
- `.workshop/` stays gitignored.

## Tests

```bash
cd runtime/shopify-theme-builder
npm test
```

Coverage includes plan without an upload, `--confirm` refusal, the dry-run
fixture manifest, Demo Theme fallback, `preview_url` shape, push arguments that
stay on `theme push --unpublished`, preserved connection / products / brand
state, and refusal of `accessUrl`.
