#!/usr/bin/env bun
// Publishes the Windows build to Cloudflare R2 (the aphrody-chromium bucket) with wrangler, under ay-tools/<chromium version>/windows-x64/,
// and moves ay-tools/latest.json to it. The bucket, the account and the token come from the environment (CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID); nothing about the account is written to a file. tools/chromium.ts package has written manifest.json.
//   bun tools/publish.ts [--dry-run]
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { home, outDir } from "./home.ts";
import { loadRegistry } from "./chromium.ts";

export const BUCKET = "aphrody-chromium";

export type Entry = { path: string; bytes: number; sha256: string };

/** The R2 keys of a build: every file of the manifest under the version's prefix, then the manifest, then the pointer to it. */
export function keysOf(version: string, files: Entry[]): { prefix: string; keys: { key: string; file: string }[]; latest: string } {
  const prefix = `ay-tools/${version}/windows-x64`;
  return { prefix, keys: [...files.map((file) => ({ key: `${prefix}/${file.path}`, file: file.path })), { key: `${prefix}/manifest.json`, file: "manifest.json" }], latest: "ay-tools/latest.json" };
}

const put = (key: string, file: string, contentType: string) => {
  const run = Bun.spawnSync(["wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", contentType, "--remote"], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`${key}: ${run.stderr.toString().trim().split("\n").slice(-2).join(" | ")}`);
};

if (import.meta.main) {
  const dry = Bun.argv.includes("--dry-run");
  const registry = loadRegistry();
  const out = outDir("windows-x64", home());
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as { files: Entry[] };
  const { keys, prefix, latest } = keysOf(registry.version, manifest.files);
  for (const { key, file } of keys) {
    const path = join(out, file);
    console.log(`${dry ? "would put" : "put"} ${key} (${statSync(path).size} bytes)`);
    if (!dry) put(key, path, file.endsWith(".json") ? "application/json" : "application/octet-stream");
  }
  const pointer = join(out, "latest.json");
  writeFileSync(pointer, JSON.stringify({ chromium: registry.version, prefix, manifest: `${prefix}/manifest.json`, published: new Date().toISOString() }) + "\n");
  console.log(`${dry ? "would put" : "put"} ${latest}`);
  if (!dry) put(latest, pointer, "application/json");
}
