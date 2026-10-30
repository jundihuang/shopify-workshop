# shopify-geo-optimizer runtime

Workshop step that turns a **shopify-geo-eval-workshop** scorecard plus a brand brief into P0 before/after product copy, writes the approved fields, then asks that same workshop runtime to score again.

This package does not carry the full diagnostic. Suggestions use the workshop scorecard gaps and the brief's category, selling points, and scene.

```text
geo.before.json + brand-brief.json
  → plan writes geo.proposal.json
  → human confirms with --approve-all-p0
  → apply writes geo.approved.json
       live: Admin productUpdate, then shopify-geo-eval-workshop --phase after
       dry-run: fixtures only
  → geo.after.json
  → workshop-state geo.optimizer_status + geo.after_score
```

## Requirements

- Node.js 20+ (no npm dependencies)
- `.workshop/<group_id>/connection.json` from `shopify-store-connect` (`store_type=preview`, `scopes_ok=true`, `write_products`)
- `.workshop/<group_id>/geo.before.json` from `shopify-geo-eval-workshop`
- `.workshop/<group_id>/brand-brief.json`
- Shopify CLI on a live apply
- Sibling runtime: `runtime/shopify-geo-eval-workshop`

## Commands

```bash
./scripts/shopify-geo-optimizer.sh plan --group-id A
./scripts/shopify-geo-optimizer.sh apply --group-id A --confirm --approve-all-p0
./scripts/shopify-geo-optimizer.sh apply --group-id A --confirm --approve-all-p0 --dry-run
```

`plan` writes `geo.proposal.json` only. It does not call Shopify.

`apply` refuses to run without `--confirm`, including `--dry-run`. It also refuses to write when there is no approved set (`--approve-all-p0` or an existing `geo.approved.json`).

P0 fields in the batch are title, description, meta_title, meta_description, and key attributes. P1 rows stay collapsed and are not written by `--approve-all-p0`. `--deep-review` accepts at most 1–2 product handles. The CLI does not ask for a line-by-line review of every suggestion.

Copy constraints:

- Include the brief category, a selling point, and the scene when those values exist.
- Drop phrases listed in `tone.avoid`.
- Drop medical and hype wording (cure, heal, miracle, guaranteed, and the same family of phrases).
- Meta title is about 60 characters. Meta description is about 150 characters.

`--dry-run` does not call Shopify and does not invoke the eval runtime. It writes `fixtures/geo.after.json` and sets `after_score` from that fixture. The fixture lists the 8 Inflation Wear workshop products. When the before scorecard has the same product count, dry-run copies those handles onto the after score and rewrites `store` to the group shop.

A live apply calls Admin `productUpdate` for the approved P0 fields, then:

```text
shopify-geo-eval-workshop apply --confirm --phase after
```

That sibling command writes `geo.after.json` and `geo.after_score`. This package does not compute the after score itself.

## Safety

- Preview Store only.
- Does not publish the theme and does not change sales channels.
- Password flags are refused.
- Artifacts must not contain an accessUrl, admin token, or storefront password.

## Tests

```bash
cd runtime/shopify-geo-optimizer && npm test
```
