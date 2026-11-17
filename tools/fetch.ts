#!/usr/bin/env bun
// Checks out the aphrody-labs forks of forks.toml outside this repository, one shallow clone each, under <home>/forks/<name>
// (tools/home.ts). The forks are plain folders: no submodule, no vendored copy. Heavy ones (bazel, turborepo) belong on the build host.
//   bun tools/fetch.ts forks [name ...]   clone or update the shallow checkouts
//   bun tools/fetch.ts list               name, upstream and checkout state
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { forksDir } from "./home.ts";

export type Fork = { name: string; upstream: string; branch: string };

export const loadForks = (file = join(resolve(import.meta.dir, ".."), "forks.toml")): { org: string; forks: Fork[] } => {
  const manifest = Bun.TOML.parse(readFileSync(file, "utf8")) as { meta: { org: string }; fork: Fork[] };
  return { org: manifest.meta.org, forks: manifest.fork };
};

export const forkUrl = (org: string, fork: Pick<Fork, "name">) => `https://github.com/${org}/${fork.name}.git`;

const git = (dir: string, ...args: string[]) => {
  const process_ = Bun.spawnSync(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: process_.exitCode ?? 1, out: process_.stdout.toString().trim(), err: process_.stderr.toString().trim() };
};

export function sync(org: string, fork: Fork, base = forksDir()): string {
  const dir = join(base, fork.name);
  if (!existsSync(join(dir, ".git"))) {
    mkdirSync(base, { recursive: true });
    const clone = Bun.spawnSync(["git", "clone", "--quiet", "--depth", "1", "--branch", fork.branch, forkUrl(org, fork), dir], { stdout: "pipe", stderr: "pipe" });
    if (clone.exitCode !== 0) throw new Error(`${fork.name}: ${clone.stderr.toString().trim()}`);
  } else {
    const fetched = git(dir, "fetch", "--quiet", "--depth", "1", "origin", fork.branch);
    if (fetched.code !== 0) throw new Error(`${fork.name}: ${fetched.err}`);
    git(dir, "checkout", "--quiet", "--detach", "FETCH_HEAD");
  }
  return git(dir, "rev-parse", "--short", "HEAD").out;
}

if (import.meta.main) {
  const [command = "list", ...names] = Bun.argv.slice(2);
  const { org, forks } = loadForks();
  const selected = forks.filter((fork) => names.length === 0 || names.includes(fork.name));
  if (command === "forks") for (const fork of selected) console.log(`${fork.name.padEnd(12)} ${sync(org, fork)}  ${join(forksDir(), fork.name)}`);
  else if (command === "list") for (const fork of selected) console.log(`${fork.name.padEnd(12)} ${fork.upstream.padEnd(26)} ${existsSync(join(forksDir(), fork.name, ".git")) ? "checked out" : "absent"}`);
  else {
    console.error("usage: fetch.ts forks [name ...] | list");
    process.exit(2);
  }
}
