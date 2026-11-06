import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { uploadLocalBannerFile } from "../src/core.js";

const TINY_JPEG = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc00011080001000103012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfa28a2803ffd9",
  "hex",
);

function makeMockGraphql(calls) {
  return async ({ query, variables, allowMutations }) => {
    calls.push({ query, variables, allowMutations });
    if (query.includes("stagedUploadsCreate")) {
      return {
        stagedUploadsCreate: {
          stagedTargets: [
            {
              url: "https://shopify-staged.example/upload",
              resourceUrl: "shopify://staged/merchant-banner.jpg",
              parameters: [{ name: "key", value: "abc123" }],
            },
          ],
          userErrors: [],
        },
      };
    }
    throw new Error(`Unexpected query in mock: ${query.slice(0, 60)}`);
  };
}

test("uploadLocalBannerFile stages, posts multipart, and returns the resource URL", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "staged-"));
  try {
    const imagePath = path.join(temp, "merchant-banner.jpg");
    await writeFile(imagePath, TINY_JPEG);

    const calls = [];
    let posted = null;
    const mockFetch = async (url, init) => {
      posted = { url, method: init.method, body: init.body };
      assert.equal(url, "https://shopify-staged.example/upload");
      assert.equal(init.method, "POST");
      assert.ok(init.body instanceof FormData, "multipart form body");
      return { ok: true, status: 200 };
    };

    const result = await uploadLocalBannerFile({
      connection: { store: "merchant.myshopify.com" },
      filePath: imagePath,
      runGraphql: makeMockGraphql(calls),
      fetchImpl: mockFetch,
    });

    assert.equal(result.originalSource, "shopify://staged/merchant-banner.jpg");
    assert.equal(result.filename, "merchant-banner.jpg");
    assert.equal(calls.length, 1, "one stagedUploadsCreate call");
    assert.equal(calls[0].allowMutations, true);
    assert.equal(calls[0].variables.input[0].resource, "FILE");
    assert.equal(calls[0].variables.input[0].mimeType, "image/jpeg");
    const fileEntry = [...posted.body.entries()].find(([name]) => name === "file");
    assert.ok(fileEntry, "multipart contains the file field");
    assert.equal(posted.body.get("key"), "abc123", "staged parameters forwarded");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("uploadLocalBannerFile rejects unsupported extensions and missing files", async () => {
  await assert.rejects(
    uploadLocalBannerFile({
      connection: { store: "x.myshopify.com" },
      filePath: "C:/definitely/missing/banner.bmp",
      runGraphql: makeMockGraphql([]),
    }),
    /Cannot read --image-file|Unsupported image extension/,
  );
});
