# brand-intake runtime

Workshop step that turns student brand answers into `brand-brief.json` for
`shopify-theme-builder` and `shopify-geo-optimizer`.

```text
student answers (or the Aurora Skincare Demo Brief)
  → brand-intake plan
  → human confirmation
  → brand-intake apply --confirm
       write .workshop/<group_id>/brand-brief.json
       set brand.status to done or fallback_demo
```

In the workshop chain this step runs after channel publish and before the theme
builder. It is local JSON only. It does not call Shopify, publish a theme, or
change products.

## Requirements

- Node.js 20+ (no npm dependencies)
- `templates/brand-brief.schema.json`
- `templates/brand-brief.demo.aurora-skincare.json` for `--demo`

## Commands

### Plan

```bash
./scripts/brand-intake.sh plan --group-id A --answers templates/brand-intake.answers.sample.json
./scripts/brand-intake.sh plan --group-id A --demo
```

Plan validates and normalizes answers against the brand brief schema. It writes
only the review artifact:

```text
.workshop/<group_id>/brand-brief.plan.json
```

The plan lists `missing[]`, `risk_flags` (phrases that will be copied into
`tone.avoid`), `participant_confirm_copy`, and two continuations:

- 用默认值继续 — `apply --confirm` fills workshop defaults and keeps `missing[]`
- 加载 Demo Brief（Aurora Skincare） — `apply --demo --confirm`

Omitted locale and currency become `en-US` and `USD` and are not listed as
missing. `pages.home`, `pages.collection`, and `pages.product` hold section
intents for skeleton theme fill. Plan does not write `brand-brief.json` and
does not change `workshop-state.yaml`.

### Apply

```bash
# Human has reviewed the plan:
./scripts/brand-intake.sh apply --group-id A --confirm --answers templates/brand-intake.answers.sample.json

# Timeout / no answers file: load the Aurora Skincare fixture. No network.
./scripts/brand-intake.sh apply --group-id A --confirm --demo --dry-run
```

`apply` refuses to run without `--confirm`, including when `--dry-run` is set.
It writes:

```text
.workshop/<group_id>/brand-brief.json
.workshop/<group_id>/workshop-state.yaml   # brand.brief_file + brand.status
```

`brand.status` is `done` for student answers (defaults allowed) and
`fallback_demo` when `--demo` loads Aurora Skincare. `--demo` does not need an
answers file. `--dry-run` is the offline rehearsal flag; this runtime never
calls Shopify in either mode.

## Safety boundaries

- No Shopify Admin, Storefront, theme, or product calls.
- No Dev Store fallback. Preview Store remains the only workshop store path;
  this step does not open one.
- Never reads or writes `accessUrl`, tokens, or the storefront password.
- Answers that contain those fields are refused before any artifact is written.
- Medical and hype phrasing is flagged into `tone.avoid` instead of being
  deleted from the source fields, so later steps can avoid repeating it.
- `.workshop/` stays gitignored.

## Tests

```bash
cd runtime/brand-intake
npm test
```

Coverage includes schema validation, missing fields, demo load, medical/hype
`tone.avoid` flags, `--confirm` refusal, and dry-run demo writes without an
answers file.
