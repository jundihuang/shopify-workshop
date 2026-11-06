# install-horizon-banner runtime

Workshop Step 9 (closing showcase step): install the workshop banner image onto
the **Horizon MAIN (live) theme** homepage hero, so the storefront preview link
(`…shopifypreview.com`) opens with the banner immediately — no password, no
admin login, no `preview_theme_id` gymnastics.

```text
workshop-summary (Step 8)
  → install-horizon-banner plan
  → human confirmation
  → install-horizon-banner apply --confirm
       fileCreate  (banner photo → store Files)
       read        templates/index.json from the MAIN theme (backed up first)
       edit        hero section settings.image_1 = shopify://shop_images/<file>
       themeFilesUpsert (templates/index.json only)
       re-read verify
  → storefront preview shows the banner
```

## Why this touches the live theme

Every other Workshop runtime writes only unpublished themes. This step is the
**approved Preview Store showcase exception**, added at the organizer's request:
the session preview link renders the live theme and Shopify strips
`?preview_theme_id=` from those links, so the only way to put a banner on the
showcase link is to put it on Horizon itself. Guardrails:

- Preview Store only (`store_type=preview`, `write_themes` scope required)
- Edits exactly **one file**: `templates/index.json`
- The original template is written to `horizon-index.backup.json` **before** the edit
- `restore --confirm` puts the backup back in one command
- Never publishes a theme, never touches products, never reads/writes the
  storefront password or accessUrl

## Requirements

- Node.js 20+ (no npm dependencies)
- `.workshop/<group_id>/connection.json` written by `shopify-store-connect`
- Shopify CLI 5+ cached Admin auth for the Preview Store

## Commands

```bash
# See what would change (reads the MAIN theme; dry-run uses the bundled fixture)
./scripts/install-horizon-banner.sh plan --group-id A

# Human has confirmed the participant_confirm_copy:
./scripts/install-horizon-banner.sh apply --group-id A --confirm

# Offline rehearsal: fixture template, no Shopify calls
./scripts/install-horizon-banner.sh apply --group-id A --confirm --dry-run

# Put the original homepage template back
./scripts/install-horizon-banner.sh restore --group-id A --confirm

# Use a different banner photo (any public https image URL)
./scripts/install-horizon-banner.sh apply --group-id A --confirm \
  --image-url "https://images.unsplash.com/photo-<id>?w=2400&h=1200&fit=crop"

# Custom hero copy (defaults: "Heavyweight tees, broken in from day one." /
# "Shop the collection"). Pass "" to leave the current copy untouched.
./scripts/install-horizon-banner.sh apply --group-id A --confirm \
  --heading "Oversized. Washed. Worn in." --button-label "See the tees"
```

Default banner: the bundled workshop photo (person with a backpack, 2400×1200
crop, Unsplash license). Default hero copy fits the Inflation Wear streetwear
tee catalog; override with `--heading` / `--button-label`.

## Artifacts

```text
.workshop/<group_id>/banner.plan.json          # plan
.workshop/<group_id>/banner.install.json       # apply result
.workshop/<group_id>/horizon-index.backup.json # pre-edit template backup
.workshop/<group_id>/workshop-state.yaml       # banner section
```

`workshop-state.yaml` gains:

```yaml
banner:
  status: done            # pending | done | restored | skipped
  theme_id: 189957767472  # MAIN theme that was edited
  image_ref: "shopify://shop_images/photo-….jpg"
  backup_file: horizon-index.backup.json
  live_theme_modified: true
```

## Gotchas baked into the code

- Horizon JSON templates start with a `/* … */` comment header; it is stripped
  before parsing and the backup keeps the original bytes.
- The hero section key is randomly suffixed (`hero_jVaWmY`); it is located by
  section type via `order`, never by hardcoded key.
- `image_picker` settings must reference store files as
  `shopify://shop_images/<filename>`. Raw CDN URLs (with or without `?v=`) are
  rejected by `themeFilesUpsert` with "does not point to an applicable
  resource"; `buildImageRef` performs the conversion.
- `fileCreate` from an external URL is asynchronous; the runtime polls the file
  node until `fileStatus=READY` before referencing it.

## Tests

```bash
cd runtime/install-horizon-banner && npm test
```

Covers: template comment stripping, hero discovery, `shopify://` ref building,
plan artifact, `--confirm` refusal, dry-run install (backup + state + redact),
restore with and without a backup, and non-preview refusal.
