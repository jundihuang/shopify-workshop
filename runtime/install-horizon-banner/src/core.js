import fs from "node:fs/promises";
import path from "node:path";
import { STAGED_UPLOADS_CREATE_MUTATION } from "./shopify.js";

const IMAGE_MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
};
import {
  FILE_CREATE_MUTATION,
  THEMES_QUERY,
  THEME_FILES_UPSERT_MUTATION,
  executeBannerGraphQL,
  fileNodeQuery,
  themeFileQuery,
} from "./shopify.js";
import {
  HOMEPAGE_TEMPLATE,
  buildImageRef,
  findHeroSection,
  heroBannerState,
  heroCopyState,
  parseTemplateJson,
  withHeroBannerImage,
  withHeroCopy,
} from "./theme.js";

export const DEFAULT_BANNER_IMAGE_URL =
  "https://images.unsplash.com/photo-1614788404413-ca65466f81f8?auto=format&fit=crop&w=2400&h=1200&q=82";

export const FIXTURE_BANNER_CDN_URL =
  "https://cdn.shopify.com/s/files/1/0000/0000/0000/files/workshop-banner-hero-fixture.jpg?v=1793800000";

export const PARTICIPANT_CONFIRM_COPY =
  "「为展示效果：把 Workshop banner 图写进 Horizon 首页 hero（仅改 templates/index.json，先备份，可还原；不发布主题，不改商品）」";

export const DEFAULT_HERO_HEADING = "Heavyweight tees, broken in from day one.";
export const DEFAULT_HERO_BUTTON_LABEL = "Shop the collection";

function assertNoUserErrors(payload, context) {
  if (payload && Array.isArray(payload.userErrors) && payload.userErrors.length > 0) {
    const detail = payload.userErrors
      .map((error) => [error.filename, (error.field || []).join("."), error.message].filter(Boolean).join(" "))
      .join("; ");
    throw new Error(`${context} rejected by Shopify: ${detail}`);
  }
}

async function loadFixtureIndex(fixturesDir) {
  const fixturePath = path.join(fixturesDir, "horizon-index.json");
  let text;
  try {
    text = await fs.readFile(fixturePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`Fixture homepage template not found at ${fixturePath}`);
    throw error;
  }
  // The fixture mirrors a real Horizon template, including its /* */ comment
  // header, so the dry-run path exercises the same stripping as production.
  return text;
}

/**
 * Resolve everything plan/apply need: the MAIN theme and its homepage
 * template. In dry-run mode both come from fixtures without touching Shopify.
 */
export async function loadHorizonContext({ connection, dryRun, fixturesDir, runGraphql = executeBannerGraphQL }) {
  if (dryRun) {
    const templateText = await loadFixtureIndex(fixturesDir);
    return {
      theme: { id: "gid://shopify/OnlineStoreTheme/900000111", name: "Horizon (fixture)", role: "MAIN" },
      template_text: templateText,
      source: "fixture",
    };
  }

  const themesData = await runGraphql({ domain: connection.store, query: THEMES_QUERY });
  const nodes = themesData?.themes?.nodes ?? [];
  const main = nodes.find((node) => String(node.role).toUpperCase() === "MAIN");
  if (!main) {
    throw new Error("No MAIN (live) theme found on this Preview Store; expected the default Horizon theme.");
  }

  const themeData = await runGraphql({
    domain: connection.store,
    query: themeFileQuery(),
    variables: { themeId: main.id },
  });
  const nodesFiles = themeData?.theme?.files?.nodes ?? [];
  const file = nodesFiles.find((node) => node.filename === HOMEPAGE_TEMPLATE);
  const body = file?.body;
  if (!body || body.__typename !== "OnlineStoreThemeFileBodyText" || typeof body.content !== "string") {
    throw new Error(`Could not read ${HOMEPAGE_TEMPLATE} from the MAIN theme as text.`);
  }
  return { theme: main, template_text: body.content, source: "admin" };
}

/**
 * Upload a local image file to the store's Files via the staged-upload flow
 * (stagedUploadsCreate -> multipart POST to the target -> fileCreate with the
 * resourceUrl). Merchants drop a photo into the chat; the CLI never needs a
 * public URL.
 */
export async function uploadLocalBannerFile({
  connection,
  filePath,
  runGraphql = executeBannerGraphQL,
  fetchImpl = (...args) => fetch(...args),
}) {
  const resolved = path.resolve(filePath);
  let bytes;
  try {
    bytes = await fs.readFile(resolved);
  } catch (error) {
    throw new Error(`Cannot read --image-file at ${resolved}: ${error.message}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  const mime = IMAGE_MIME_BY_EXT[ext];
  if (!mime) throw new Error(`Unsupported image extension "${ext}". Use jpg, jpeg, png, webp, gif, or avif.`);
  const filename = path.basename(resolved);

  const stagedData = await runGraphql({
    domain: connection.store,
    query: STAGED_UPLOADS_CREATE_MUTATION,
    variables: { input: [{ resource: "FILE", filename, mimeType: mime, httpMethod: "POST" }] },
    allowMutations: true,
  });
  const staged = stagedData?.stagedUploadsCreate;
  if (!staged || (Array.isArray(staged.userErrors) && staged.userErrors.length > 0)) {
    const detail = staged?.userErrors?.map((e) => `${(e.field || []).join(".")}: ${e.message}`).join("; ") || "no staged target";
    throw new Error(`stagedUploadsCreate failed: ${detail}`);
  }
  const target = staged.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) throw new Error("stagedUploadsCreate returned no usable target.");

  const form = new FormData();
  for (const param of target.parameters ?? []) form.append(param.name, param.value);
  form.append("file", new Blob([bytes], { type: mime }), filename);
  const response = await fetchImpl(target.url, { method: "POST", body: form });
  if (!response.ok) {
    throw new Error(`Uploading the banner file failed (HTTP ${response.status}).`);
  }
  return { originalSource: target.resourceUrl, filename };
}

async function uploadBannerImage({ connection, imageUrl, runGraphql, sleep }) {
  const created = await runGraphql({
    domain: connection.store,
    query: FILE_CREATE_MUTATION,
    variables: { files: [{ contentType: "IMAGE", originalSource: imageUrl }] },
    allowMutations: true,
  });
  assertNoUserErrors(created?.fileCreate, "fileCreate");
  const file = created?.fileCreate?.files?.[0];
  if (!file?.id) throw new Error("fileCreate returned no file id.");

  let node = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const data = await runGraphql({
      domain: connection.store,
      query: fileNodeQuery(),
      variables: { fileId: file.id },
    });
    node = data?.node ?? null;
    if (node?.fileStatus === "READY") break;
    if (node?.fileStatus && /FAIL|ERROR/i.test(node.fileStatus)) {
      throw new Error(`Banner image upload failed with status ${node.fileStatus}.`);
    }
    await sleep(1000);
  }
  if (node?.fileStatus !== "READY" || !node?.image?.url) {
    throw new Error(`Banner image did not become READY in time (status: ${node?.fileStatus ?? "unknown"}).`);
  }
  return { fileId: file.id, cdnUrl: node.image.url, width: node.image.width, height: node.image.height };
}

/**
 * Full install: upload the banner image, back up the homepage template, set
 * hero image_1, upsert the template, then re-read it to verify.
 */
export async function installBanner({
  connection,
  groupDir,
  imageUrl = DEFAULT_BANNER_IMAGE_URL,
  imageFile = null,
  heading = DEFAULT_HERO_HEADING,
  buttonLabel = DEFAULT_HERO_BUTTON_LABEL,
  dryRun = false,
  fixturesDir,
  runGraphql = executeBannerGraphQL,
  fetchImpl = (...args) => fetch(...args),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  writeBackup,
  writeResult,
}) {
  const context = await loadHorizonContext({ connection, dryRun, fixturesDir, runGraphql });
  const indexObject = parseTemplateJson(context.template_text);
  const { key: heroKey } = findHeroSection(indexObject);
  const before = heroBannerState(indexObject, heroKey);
  const copyBefore = heroCopyState(indexObject, heroKey);

  let cdnUrl = FIXTURE_BANNER_CDN_URL;
  let fileId = null;
  let uploaded = null;
  if (!dryRun) {
    if (imageFile) {
      const staged = await uploadLocalBannerFile({ connection, filePath: imageFile, runGraphql, fetchImpl });
      uploaded = await uploadBannerImage({ connection, imageUrl: staged.originalSource, runGraphql, sleep });
    } else {
      uploaded = await uploadBannerImage({ connection, imageUrl, runGraphql, sleep });
    }
    cdnUrl = uploaded.cdnUrl;
    fileId = uploaded.fileId;
  }
  const imageRef = buildImageRef(cdnUrl);
  let nextIndex = withHeroBannerImage(indexObject, heroKey, imageRef);
  if (heading !== null || buttonLabel !== null) {
    nextIndex = withHeroCopy(nextIndex, heroKey, { heading, buttonLabel });
  }
  const copyAfter = heroCopyState(nextIndex, heroKey);

  let upsert = null;
  if (!dryRun) {
    upsert = await runGraphql({
      domain: connection.store,
      query: THEME_FILES_UPSERT_MUTATION,
      variables: {
        themeId: context.theme.id,
        files: [{ filename: HOMEPAGE_TEMPLATE, body: { type: "TEXT", value: JSON.stringify(nextIndex) } }],
      },
      allowMutations: true,
    });
    assertNoUserErrors(upsert?.themeFilesUpsert, "themeFilesUpsert");
  }

  let verifiedRef = imageRef;
  let verified = dryRun ? "fixture" : "unverified";
  if (!dryRun) {
    const reread = await loadHorizonContext({ connection, dryRun, fixturesDir, runGraphql });
    const rereadIndex = parseTemplateJson(reread.template_text);
    verifiedRef = heroBannerState(rereadIndex, findHeroSection(rereadIndex).key);
    verified = verifiedRef === imageRef ? "verified" : "mismatch";
    if (verified === "mismatch") {
      throw new Error(
        `Re-read check failed: hero image_1 is ${JSON.stringify(verifiedRef)}, expected ${JSON.stringify(imageRef)}.`,
      );
    }
  }

  const backupFile = await writeBackup(context.template_text);
  const result = {
    ok: true,
    schema_version: "1.0",
    artifact: "banner.install.json",
    command: "apply",
    group_id: connection.groupId,
    store: connection.store,
    store_type: "preview",
    dry_run: dryRun,
    shopify_called: !dryRun,
    live_theme_modified: !dryRun,
    theme: { id: context.theme.id, name: context.theme.name, role: context.theme.role },
    hero_section: heroKey,
    image_1_before: before,
    image_ref: imageRef,
    image_cdn_url: dryRun ? cdnUrl : "[written to shop files]",
    copy_before: copyBefore,
    copy_after: copyAfter,
    upload_file_id: fileId,
    upload_dimensions: uploaded ? { width: uploaded.width, height: uploaded.height } : null,
    source_template: context.source,
    backup_file: backupFile,
    verified,
    participant_confirm_copy: PARTICIPANT_CONFIRM_COPY,
    notes: [
      "This step edits the Horizon MAIN (live) theme homepage template. It is the approved",
      "Preview Store showcase exception: one file only, backed up first, restorable via",
      "install-horizon-banner restore. It never publishes a theme and never touches products.",
    ],
  };
  await writeResult(result);
  return result;
}

/**
 * Restore the backed-up homepage template onto the MAIN theme.
 */
export async function restoreBanner({
  connection,
  dryRun = false,
  runGraphql = executeBannerGraphQL,
  readBackup,
}) {
  const backupText = await readBackup();
  const indexObject = parseTemplateJson(backupText);

  if (dryRun) {
    return { ok: true, dry_run: true, shopify_called: false, restored_from: "horizon-index.backup.json", verified: "fixture" };
  }

  const context = await loadHorizonContext({ connection, dryRun: false, runGraphql });
  const upsert = await runGraphql({
    domain: connection.store,
    query: THEME_FILES_UPSERT_MUTATION,
    variables: {
      themeId: context.theme.id,
      files: [{ filename: HOMEPAGE_TEMPLATE, body: { type: "TEXT", value: JSON.stringify(indexObject) } }],
    },
    allowMutations: true,
  });
  assertNoUserErrors(upsert?.themeFilesUpsert, "themeFilesUpsert");
  const reread = await loadHorizonContext({ connection, dryRun: false, runGraphql });
  const rereadIndex = parseTemplateJson(reread.template_text);
  const hero = heroBannerState(rereadIndex, findHeroSection(rereadIndex).key);
  return {
    ok: true,
    dry_run: false,
    shopify_called: true,
    restored_from: "horizon-index.backup.json",
    hero_image_1_after_restore: hero,
    verified: hero ? "image_still_set" : "cleared",
  };
}
