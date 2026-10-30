import fs from "node:fs/promises";
import path from "node:path";

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON fixture at ${filePath}: ${error.message}`);
  }
}

export async function readConnection(filePath) {
  const connection = await readJsonFile(filePath);
  if (!connection || typeof connection.store !== "string") {
    throw new Error(`Connection artifact at ${filePath} does not contain a store domain`);
  }
  return connection;
}

export async function writePrivateFile(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, contents, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, filePath);
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // chmod is best effort on filesystems that do not support it.
  }
}

export async function writeConnectionJson(filePath, connection, accessUrlForGuard) {
  const text = `${JSON.stringify(connection, null, 2)}\n`;
  assertNoRawAccessUrl(text, accessUrlForGuard);
  await writePrivateFile(filePath, text);
}

export function assertNoRawAccessUrl(text, accessUrl) {
  if (accessUrl && typeof accessUrl === "string" && text.includes(accessUrl)) {
    throw new Error("Refusing to write an artifact containing the raw accessUrl session credential");
  }
}

export async function findRepoRoot(startPath) {
  let current = path.resolve(startPath);
  for (;;) {
    if (await pathExists(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Ensure the root .gitignore ignores the runtime workspace. This is idempotent
 * and intentionally does not touch a workdir outside a detected git repository.
 */
export async function ensureWorkshopGitignore(groupDir) {
  const repoRoot = await findRepoRoot(groupDir);
  if (!repoRoot) return null;

  const gitignorePath = path.join(repoRoot, ".gitignore");
  let text = "";
  if (await pathExists(gitignorePath)) text = await fs.readFile(gitignorePath, "utf8");

  const alreadyIgnored = text
    .split(/\r?\n/)
    .some((line) => line.trim() === ".workshop/" || line.trim() === ".workshop");
  if (alreadyIgnored) return gitignorePath;

  const prefix = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
  const separator = text.trim().length > 0 ? "\n" : "";
  const next = `${text}${prefix}${separator}# Workshop runtime state (contains local session handles only; never access URLs)\n.workshop/\n`;
  await fs.writeFile(gitignorePath, next, "utf8");
  return gitignorePath;
}

function yamlScalar(value) {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(String(value));
}

function topLevelKeyIndex(lines, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}:`);
  return lines.findIndex((line) => pattern.test(line));
}

function upsertTopLevelScalar(lines, key, value) {
  const index = topLevelKeyIndex(lines, key);
  const line = `${key}: ${yamlScalar(value)}`;
  if (index === -1) {
    lines.push(line);
  } else {
    lines[index] = line;
  }
  return lines;
}

function upsertTopLevelBlock(lines, key, blockLines) {
  const start = topLevelKeyIndex(lines, key);
  if (start === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push(...blockLines);
    return lines;
  }

  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() !== "" && !/^\s/.test(line)) break;
    end += 1;
  }

  // Keep one separating blank line before the next top-level section.
  while (end > start + 1 && lines[end - 1] === "") end -= 1;
  const replacement = [...blockLines];
  if (end < lines.length) replacement.push("");
  lines.splice(start, end - start, ...replacement);
  return lines;
}

/**
 * Update only the top-level identity fields and connection block while
 * preserving unrelated sections written by other Workshop skills.
 */
export function updateWorkshopStateYaml(existingText, {
  groupId,
  storeDomain,
  mode = "demo",
  status,
  scopesOk,
}) {
  let text = typeof existingText === "string" ? existingText.replace(/\r\n/g, "\n") : "";
  if (text.length > 0 && !text.endsWith("\n")) text += "\n";

  const lines = text.length > 0 ? text.slice(0, -1).split("\n") : [];
  upsertTopLevelScalar(lines, "group_id", groupId);
  upsertTopLevelScalar(lines, "store_domain", storeDomain);
  upsertTopLevelScalar(lines, "mode", mode);

  const connectionBlock = [
    "connection:",
    `  status: ${status}`,
    "  store_type: preview",
    `  scopes_ok: ${Boolean(scopesOk)}`,
    "  auth: cli_cached_admin_token",
    "  storefront_session: access_url",
  ];
  upsertTopLevelBlock(lines, "connection", connectionBlock);

  let output = `${lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "")}\n`;

  // The state has no access URL field. These checks catch accidental future
  // changes that try to smuggle a session URL through this writer.
  if (/access[_-]?url\s*:\s*https?:\/\//i.test(output)) {
    throw new Error("Refusing to write workshop-state.yaml with an accessUrl value");
  }
  return output;
}

export async function readTextOrEmpty(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

export function relativeArtifactPath(filePath, cwd = process.cwd()) {
  const relative = path.relative(cwd, filePath);
  return relative && !relative.startsWith("..") ? relative : filePath;
}
