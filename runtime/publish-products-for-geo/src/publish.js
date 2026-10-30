import path from "node:path";
import { readJsonFile } from "./files.js";
import { CONFIRM_COPY } from "./plan.js";
import { activateAndPublishProduct, fetchOnlineStorePublication } from "./shopify.js";
import { redactSensitiveText } from "./redact.js";

export function channelResultPath(groupDir) {
  return path.join(groupDir, "products.channel.json");
}

function fixturePublication(fixture) {
  return {
    id: fixture?.publication?.id || "gid://shopify/Publication/7000000001",
    name: fixture?.publication?.name || "Online Store",
  };
}

function dryRunProductResult(product) {
  return {
    ...product,
    ok: true,
    fake: true,
    status_before: product.current_status || "draft",
    status_after: "ACTIVE",
    published_to_online_store: true,
    errors: [],
  };
}

export async function publishProducts({
  plan,
  connection,
  dryRun = false,
  executeGraphql,
  fixturesDir,
}) {
  let publication;
  let products;

  if (dryRun) {
    if (!fixturesDir) throw new Error("A fixtures directory is required for --dry-run");
    const fixture = await readJsonFile(path.join(fixturesDir, "channel-publish.success.json"));
    publication = fixturePublication(fixture);
    products = plan.products.map(dryRunProductResult);
  } else {
    publication = await fetchOnlineStorePublication({
      domain: connection.store,
      executeGraphql,
    });
    products = [];
    for (const product of plan.products) {
      try {
        const result = await activateAndPublishProduct({
          domain: connection.store,
          product,
          publicationId: publication.id,
          executeGraphql,
        });
        products.push({
          ...result,
          status_before: product.current_status || null,
          fake: false,
        });
      } catch (error) {
        products.push({
          ...product,
          ok: false,
          fake: false,
          status_before: product.current_status || null,
          status_after: null,
          published_to_online_store: false,
          errors: [redactSensitiveText(error.message)],
        });
      }
    }
  }

  const activated = products.filter((product) => product.ok || product.status_after === "ACTIVE").length;
  const published = products.filter((product) => product.ok && product.published_to_online_store).length;
  const failed = products.length - published;
  const allSucceeded = products.length > 0 && failed === 0;

  return {
    schema_version: "1.0",
    artifact: "products.channel.json",
    generated_at: new Date().toISOString(),
    dry_run: Boolean(dryRun),
    fake: Boolean(dryRun),
    mode: dryRun ? "fixture" : "shopify_admin_graphql",
    command: "apply",
    store: connection.store,
    store_type: "preview",
    auth: connection.auth,
    confirmation: "--confirm",
    participant_confirm_copy: CONFIRM_COPY,
    target_publication: publication,
    theme: {
      touched: false,
      published: false,
      action: "none",
    },
    shopify_status: allSucceeded ? "active" : "partial",
    channel_publish: allSucceeded,
    channels_published: allSucceeded,
    summary: {
      planned: products.length,
      activated,
      published,
      failed,
    },
    products,
    error: failed > 0 ? `${failed} product(s) failed during Active + Online Store publishing` : null,
  };
}
