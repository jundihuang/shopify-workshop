# workshop-summary runtime

Closing step for a ShopWright Workshop group. It reads the artifacts already written under `.workshop/<group_id>/` and writes the delivery summary. It does not call Shopify, does not rescore, and does not publish the theme.

This page is a workshop scorecard summary, not the full diagnostic. Scores are copied from `shopify-geo-eval-workshop` (`geo.before.json` / `geo.after.json`). The five dimensions stay Product Data Completeness, Search Findability, AI Understandability, Purchase Trust, and Technical Visibility.

```text
connection + import + channel + brand brief + theme
  + geo.before + geo.proposal + geo.approved + geo.after
  → plan writes workshop-summary.plan.json
  → apply writes workshop-summary.md
       workshop-summary.html
       workshop-summary.json
       workshop-state.yaml summary.status
```

## Requirements

- Node.js 20+ (no npm dependencies)
- Group artifacts from the earlier workshop steps, when this is a live close-out
- Fixture directory `fixtures/` for `--dry-run` when those artifacts are only partly present

Preview Store is the only store path. A `connection.json` whose `store_type` is anything else is refused. A missing connection is allowed: the checklist records it, and `--dry-run` fills the fixture Preview Store.

## Commands

```bash
./scripts/workshop-summary.sh plan --group-id A
./scripts/workshop-summary.sh apply --group-id A --confirm
./scripts/workshop-summary.sh apply --group-id A --confirm --dry-run
```

`plan` inventories what is present and writes `workshop-summary.plan.json`. It does not write the summary pages.

`apply` refuses to run without `--confirm`, including `--dry-run`. It writes:

```text
.workshop/<group_id>/workshop-summary.md
.workshop/<group_id>/workshop-summary.html
.workshop/<group_id>/workshop-summary.json
```

and sets `summary.status` in `workshop-state.yaml` to `done` (live apply) or `demo` (`--dry-run`). `summary.before_score`, `summary.after_score`, and `summary.improvement` are recorded there. Other sections of the state file stay as the earlier steps left them.

`--dry-run` still makes no Shopify call. When a known artifact is missing or unreadable, that one file is filled from `fixtures/` for the summary only. Files that are already in the group directory are kept, including a brand name or a score that differs from the fixture. The filled names are listed in `fixture_filled`. Earlier artifacts such as `geo.after.json` are not written back.

The delivery checklist on the page is:

- Preview Store connected
- 5–10 products imported
- Online Store channel, with the theme still unpublished
- Unpublished theme preview (`https://{store}/?preview_theme_id={id}` only)
- Brand Brief
- GEO before score
- GEO after score
- Approved P0 changes
- This Workshop Summary

## Safety

- No Shopify CLI and no Admin API.
- Preview Store is the only store path.
- Password flags are refused.
- A scorecard whose `skill` is not `shopify-geo-eval-workshop` is refused.
- Artifacts must not contain an accessUrl, admin token, or storefront password. The storefront session is recorded only as the handle `access_url` or `none`.
- A preview URL that is not an unpublished `preview_theme_id` link for this store is withheld.

## Tests

```bash
cd runtime/workshop-summary && npm test
```
