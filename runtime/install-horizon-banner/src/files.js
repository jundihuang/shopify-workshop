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
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`File not found: ${filePath}`);
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON at ${filePath}: ${error.message}`);
  }
}

export async function readTextOrEmpty(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

export async function writePrivateJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(filePath, text, { mode: 0o600 });
  return text;
}

export async function writePrivateText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, text, { mode: 0o600 });
  return text;
}

export async function ensureWorkshopGitignore(groupDir) {
  let root = path.resolve(groupDir);
  while (true) {
    if (await pathExists(path.join(root, ".git"))) break;
    const parent = path.dirname(root);
    if (parent === root) {
      root = process.cwd();
      break;
    }
    root = parent;
  }
  const gitignorePath = path.join(root, ".gitignore");
  const existing = await readTextOrEmpty(gitignorePath);
  if (!/^\.workshop\/$/m.test(existing)) {
    const prefix = existing && !existing.endsWith("\n") ? `${existing}\n` : existing;
    await fs.writeFile(gitignorePath, `${prefix}.workshop/\n`, { mode: 0o600 });
  }
  return gitignorePath;
}

export function relativeArtifactPath(filePath, cwd = process.cwd()) {
  const absolute = path.resolve(filePath);
  const relative = path.relative(cwd, absolute);
  return relative && !relative.startsWith("..") ? relative : absolute;
}
