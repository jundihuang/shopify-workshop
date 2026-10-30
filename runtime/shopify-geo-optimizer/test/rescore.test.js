import test from "node:test";
import assert from "node:assert/strict";
import { workshopEvalInvocation } from "../src/rescore.js";
import { WORKSHOP_EVAL_CLI } from "../src/paths.js";

test("after path calls the workshop eval runtime", () => {
  const invocation = workshopEvalInvocation({ groupDir: "/tmp/group-a", skipHtml: true });
  assert.equal(invocation.args[0], WORKSHOP_EVAL_CLI);
  assert.match(invocation.args[0], /shopify-geo-eval-workshop\/src\/cli\.js$/);
  assert.deepEqual(invocation.args.slice(1), [
    "apply",
    "--group-dir",
    "/tmp/group-a",
    "--confirm",
    "--phase",
    "after",
    "--skip-html",
  ]);
});

test("after path refuses a program other than the workshop eval runtime", () => {
  assert.throws(
    () => workshopEvalInvocation({ groupDir: "/tmp/group-a", cliPath: "/opt/other/scripts/run.py" }),
    /shopify-geo-eval-workshop/,
  );
});
