#!/usr/bin/env bun
// Parity of `ay-deps list` with a plain-Python evaluation of the same DEPS file (tools/parity_deps.py), for several targets.
//   bun tools/parity.ts <ay-deps binary> <DEPS file> <depot_tools dir>   (tools/reference.ts fetch depot_tools)
// The DEPS file is Chromium's, fetched by the caller (tools/reference.ts fetch-deps); nothing here is specific to one file.
import { join } from "node:path";

export type Target = { os: string; cpu: string; vars?: string[] };

export const TARGETS: Target[] = [
  { os: "linux", cpu: "x64" },
  { os: "android", cpu: "arm64" },
  { os: "win", cpu: "x64" },
  { os: "mac", cpu: "arm64" },
  { os: "ios", cpu: "arm64" },
  { os: "linux", cpu: "x64", vars: ["checkout_android=True", "checkout_nacl=False"] },
];

const run = async (command: string[]): Promise<string> => {
  const process_ = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(process_.stdout).text(), new Response(process_.stderr).text(), process_.exited]);
  if (code !== 0) throw new Error(`${command.slice(0, 2).join(" ")}: ${err.trim().split("\n").slice(-1)[0]}`);
  return out;
};

const canonical = (text: string) => JSON.parse(text, (_, value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value));

export async function compare(binary: string, deps: string, depotTools: string, target: Target): Promise<{ same: boolean; count: number; only_rust: string[]; only_python: string[]; differing: string[] }> {
  const flags = (target.vars ?? []).flatMap((pair) => ["--var", pair]);
  const [rust, python] = await Promise.all([
    run([binary, "list", deps, "--os", target.os, "--cpu", target.cpu, ...flags]),
    run(["python3", join(import.meta.dir, "parity_deps.py"), depotTools, deps, "linux", "x64", target.os, target.cpu, ...(target.vars ?? [])]),
  ]);
  const left = canonical(rust) as { deps: { path: string }[]; hooks: unknown[]; recursedeps: string[] };
  const right = canonical(python) as typeof left;
  const index = (list: { path: string }[]) => new Map(list.map((item) => [item.path, JSON.stringify(item)]));
  const [a, b] = [index(left.deps), index(right.deps)];
  const only_rust = [...a.keys()].filter((key) => !b.has(key));
  const only_python = [...b.keys()].filter((key) => !a.has(key));
  const differing = [...a.keys()].filter((key) => b.has(key) && a.get(key) !== b.get(key));
  const same = only_rust.length + only_python.length + differing.length === 0 && JSON.stringify(left.hooks) === JSON.stringify(right.hooks) && JSON.stringify(left.recursedeps) === JSON.stringify(right.recursedeps);
  return { same, count: a.size, only_rust, only_python, differing };
}

if (import.meta.main) {
  const [binary, deps, depotTools] = Bun.argv.slice(2);
  if (!binary || !deps || !depotTools) {
    console.error("usage: bun tools/parity.ts <ay-deps binary> <DEPS file> <depot_tools dir>");
    process.exit(2);
  }
  let failed = 0;
  for (const target of TARGETS) {
    const result = await compare(binary, deps, depotTools, target);
    failed += result.same ? 0 : 1;
    console.log(`${result.same ? "same" : "DIFF"} ${target.os}/${target.cpu}${target.vars ? ` ${target.vars.join(" ")}` : ""}: ${result.count} dependencies`);
    if (!result.same) console.log(JSON.stringify({ only_rust: result.only_rust.slice(0, 5), only_python: result.only_python.slice(0, 5), differing: result.differing.slice(0, 5) }));
  }
  process.exit(failed ? 1 : 0);
}
