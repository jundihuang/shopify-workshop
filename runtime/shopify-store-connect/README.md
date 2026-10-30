# shopify-store-connect runtime (MVP)

Workshop Step 1 executable runtime. It shells out to the Shopify CLI, creates a
**Preview Store**, reads store info, verifies the CLI-cached Admin API scopes,
and writes only safe connection handles under a gitignored group workdir.

- Stack: Node.js 20+ (no npm dependencies)
- Shopify CLI target: validated against **Shopify CLI 5.0.0**
- Store path: Preview Store only (`shopify store create preview`)
- Auth: Shopify CLI cached Admin token
- Human confirmation: **outside** this CLI. The CLI assumes the agent already
  obtained participant confirmation.

## Quick start

Run from the repository root:

```bash
# End-to-end: create -> store info -> verify scopes -> safe artifacts
./scripts/store-connect.sh connect \
  --group-id A \
  --name "Group A Aurora" \
  --mode demo

# Stepwise flow
./scripts/store-connect.sh create --group-id A --name "Group A Aurora"
./scripts/store-connect.sh info --group-id A
./scripts/store-connect.sh verify --group-id A
./scripts/store-connect.sh open --group-id A
```

`info` intentionally prints the ephemeral `access_url` to **stdout only**.
Never redirect that output to a file, paste it into docs, or persist it in
state. `create`, `verify`, `connect`, and `open` never print or write the raw
URL.

Direct Node invocation is equivalent:

```bash
node runtime/shopify-store-connect/src/cli.js connect \
  --group-id A \
  --name "Group A Aurora" \
  --mode demo
```

## Dry run / CI mode

Dry runs use bundled fake JSON fixtures and never invoke the Shopify CLI or
write a real secret:

```bash
./scripts/store-connect.sh connect \
  --group-id demo-group \
  --name "Demo Group Aurora" \
  --dry-run

./scripts/store-connect.sh info --group-id demo-group --dry-run
./scripts/store-connect.sh verify --group-id demo-group --dry-run
./scripts/store-connect.sh open --group-id demo-group --dry-run
```

To supply your own fixture files:

```bash
./scripts/store-connect.sh connect \
  --group-id fixture-group \
  --name "Fixture Group Borealis" \
  --dry-run \
  --fixture-create ./my-create.json \
  --fixture-info ./my-info.json
```

Keep custom fixtures fictional and non-secret. The bundled `accessUrl` points at
`preview.example.invalid` and exists only to exercise redaction checks.

## Artifacts

Default group workdir: `.workshop/<group-id>/` (the runtime adds `.workshop/`
to the repository `.gitignore` when missing).

`connection.json` example using a fictional domain:

```json
{
  "store": "aurora-workshop.myshopify.com",
  "store_name": "Group A Aurora",
  "store_type": "preview",
  "auth": "cli_cached_admin_token",
  "scopes_ok": true,
  "scopes_include": ["write_products", "write_themes", "write_publications"],
  "storefront_session": "access_url",
  "password_protection_enabled": true,
  "product_count": 0
}
```

`password_protection_enabled` is included only when the CLI reports the Admin
switch as a boolean. It is not a password and the runtime never reads or sets a
storefront password.

`workshop-state.yaml` gets the matching connection section while preserving
other workshop sections already present:

```yaml
connection:
  status: connected
  store_type: preview
  scopes_ok: true
  auth: cli_cached_admin_token
  storefront_session: access_url
```

## Commands

| Command | Behavior |
|---|---|
| `create` | Runs `shopify store create preview --name <name> --json`, parses the store domain, and writes a safe draft `connection.json`. |
| `info` | Runs `shopify store info --store <domain> --json` and returns store metadata plus the ephemeral raw `access_url` on stdout. Writes nothing. |
| `verify` | Reads store info, checks the required `write_products`, `write_themes`, and `write_publications` scopes, and returns a URL-free verification object. Exits `2` when scopes are missing. |
| `connect` / `run` | Executes create -> info -> verify -> writes `connection.json` and `workshop-state.yaml`. |
| `open` | Attempts `shopify store open --store <domain>` for interactive use; falls back to a safe command/guidance object when no browser is available. |

Useful flags:

- `--group-id <id>`: group identifier used for `.workshop/<id>/`.
- `--workdir <dir>`: parent workdir, default `.workshop`.
- `--group-dir <dir>`: explicit group directory override.
- `--mode demo|hands_on`: state mode, default `demo`.
- `--country <CC>`: optional ISO country code passed to store creation.
- `--store <domain.myshopify.com>`: use info/verify/open without reading a
  connection artifact.
- `--dry-run`: use fixtures; no Shopify CLI calls.
- `--json`: accepted for agent compatibility; JSON output is the default.

## CLI version assumptions and compatibility

The runtime targets Shopify CLI `5.0.0` behavior:

```text
shopify store create preview --name … --json
shopify store info --store … --json
shopify store open --store … --json
```

Before every real command, the runtime probes `<command> --help` for `--json`
and records the CLI version. If a CLI build does not advertise `--json`, it
fails with upgrade/flag hints instead of scraping human-readable output. There
is no non-JSON fallback because raw `accessUrl` values must only travel through
the JSON session path.

Set `SHOPIFY_CLI_BIN` to use a non-default CLI executable.
`SHOPIFY_CLI_TIMEOUT_MS` can raise the default 180-second command timeout.

## Troubleshooting

1. Retry the same command once for transient CLI/network failures.
2. If `store create preview` fails again, try a different display store name.
3. Check `shopify version`, CLI sign-in, and classroom network/proxy access.
4. If `access_url` or required scopes are still missing, pause the group and
   ask the facilitator. Do not use a Dev Store, a Custom App token paste flow,
   or request the Opening soon password.

## Tests

```bash
cd runtime/shopify-store-connect
npm test
```

The tests cover create/info JSON parsing, Preview Store rejection, scope
verification, YAML preservation, gitignore setup, and an end-to-end dry run
that scans every written file to prove the fixture `accessUrl` never lands on
disk.
