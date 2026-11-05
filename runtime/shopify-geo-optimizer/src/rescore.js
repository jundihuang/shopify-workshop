import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { REPO_ROOT, WORKSHOP_EVAL_CLI } from "./paths.js";

const execFileAsync = promisify(execFile);

// Shopify CLI 5 writes NDJSON progress to stderr and the error JSON to stdout.
// Strip progress noise and prefer the structured error payload.
function cliFailureDetail(error, fallback = "Shopify CLI command failed") {
  const dropProgress = (text) =>
    String(text || "")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !/^\s*\{\s*"type"\s*:\s*"progress"/.test(line))
      .join("\n")
      .trim();
  const stdoutDetail = dropProgress(error.stdout);
  const stderrDetail = dropProgress(error.stderr);
  if (stdoutDetail) return stdoutDetail;
  if (stderrDetail) return stderrDetail;
  return String(error.message || fallback);
}

export function workshopEvalInvocation({ groupDir, skipHtml = false, cliPath } = {}) {
  if (!groupDir) throw new Error("groupDir is required to rescore");
  const override = process.env.SHOPIFY_GEO_EVAL_CLI;
  const selected = cliPath || override || WORKSHOP_EVAL_CLI;
  const allowed = new Set([path.resolve(WORKSHOP_EVAL_CLI)]);
  if (override) allowed.add(path.resolve(override));
  if (!allowed.has(path.resolve(selected))) {
    throw new Error("Refusing to rescore with anything other than the shopify-geo-eval-workshop runtime");
  }
  const args = [selected, "apply", "--group-dir", groupDir, "--confirm", "--phase", "after"];
  if (skipHtml) args.push("--skip-html");
  return { command: process.execPath, args };
}

export async function rescoreWithWorkshopEval({
  groupDir,
  skipHtml = false,
  cliPath,
  execFileImpl = execFileAsync,
  cwd = REPO_ROOT,
} = {}) {
  const invocation = workshopEvalInvocation({ groupDir, skipHtml, cliPath });
  try {
    await execFileImpl(invocation.command, invocation.args, {
      cwd,
      env: { ...process.env },
      encoding: "utf8",
      timeout: Number(process.env.SHOPIFY_GEO_EVAL_TIMEOUT_MS || 120_000),
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const detail = cliFailureDetail(error, "workshop rescore failed");
    throw new Error(`shopify-geo-eval-workshop rescore failed: ${detail.slice(0, 500)}`);
  }
  return invocation;
}
