#!/usr/bin/env bun
// Pinned references (ay-tools.toml): the Chromium tools are not on GitHub, so a tree at a pinned commit is fetched as an archive from
// gitiles into the git-ignored .cache/<name>/, to read their behavior and to test against them. Nothing is copied into the repository.
//   bun tools/reference.ts fetch [name ...]    download the pinned trees that are not in .cache yet
//   bun tools/reference.ts update [name ...]   move each pin to the current main commit (edits ay-tools.toml), then fetch
//   bun tools/reference.ts check               report the references whose upstream moved
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const REGISTRY = join(ROOT, "ay-tools.toml");

export type Reference = { name: string; url: string; commit: string; path?: string; license: string; takes: string };

export const loadReferences = (): Reference[] => (Bun.TOML.parse(readFileSync(REGISTRY, "utf8")) as { reference: Reference[] }).reference;

/** The gitiles archive URL of a tree (the whole repository or one path) at a commit. */
export const archiveUrl = (reference: Pick<Reference, "url" | "commit" | "path">): string => `${reference.url}/+archive/${reference.commit}${reference.path ? `/${reference.path}` : ""}.tar.gz`;

export const cacheDir = (reference: Pick<Reference, "name">, root = ROOT): string => join(root, ".cache", reference.name);

async function fetchReference(reference: Reference, root = ROOT): Promise<string> {
  const dir = cacheDir(reference, root);
  const marker = join(dir, ".commit");
  if (existsSync(marker) && readFileSync(marker, "utf8").trim() === reference.commit) return dir;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const response = await fetch(archiveUrl(reference));
  if (!response.ok) throw new Error(`${response.status} ${archiveUrl(reference)}`);
  const tar = Bun.spawn(["tar", "-xz", "-C", dir], { stdin: response.body, stderr: "pipe" });
  const [error, code] = await Promise.all([new Response(tar.stderr).text(), tar.exited]);
  if (code !== 0) throw new Error(`tar failed for ${reference.name}: ${error.trim().split("\n")[0]}`);
  writeFileSync(marker, `${reference.commit}\n`);
  return dir;
}

async function head(reference: Reference): Promise<string> {
  const response = await fetch(`${reference.url}/+/refs/heads/main?format=JSON`);
  const text = (await response.text()).replace(/^\)\]\}'\n/, "");
  return (JSON.parse(text) as { commit: string }).commit;
}

if (import.meta.main) {
  const [command = "fetch", ...only] = Bun.argv.slice(2);
  const references = loadReferences().filter((reference) => only.length === 0 || only.includes(reference.name));
  if (command === "fetch") {
    for (const reference of references) console.log(`${reference.name} ${reference.commit.slice(0, 9)} -> ${await fetchReference(reference)}`);
  } else if (command === "check" || command === "update") {
    let text = readFileSync(REGISTRY, "utf8");
    for (const reference of references) {
      const latest = await head(reference);
      if (latest === reference.commit) continue;
      console.log(`${reference.name}: pinned ${reference.commit.slice(0, 9)}, main ${latest.slice(0, 9)}`);
      if (command === "update" && !reference.path) text = text.replace(reference.commit, latest);
    }
    if (command === "update") {
      writeFileSync(REGISTRY, text);
      for (const reference of loadReferences().filter((entry) => only.length === 0 || only.includes(entry.name))) await fetchReference(reference);
    }
  } else {
    console.error("usage: reference.ts fetch|update|check [name ...]");
    process.exit(2);
  }
}
