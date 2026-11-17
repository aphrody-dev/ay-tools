#!/usr/bin/env bun
// Chromium's build tools and infra, from the revisions one real Chromium release pins, built for Windows from the build host.
//   bun tools/chromium.ts plan                 resolve the DEPS of the pinned Chromium and print every source with its pin
//   bun tools/chromium.ts fetch [name ...]     fetch each source at its pin into <home>/chromium/<version>/src/<name>
//   bun tools/chromium.ts build [tool ...]     build the tools for Windows into <home>/out/windows-x64 (Go, CMake with clang-cl, copy)
//   bun tools/chromium.ts package              zip the outputs with a manifest of sizes and SHA-256
// The pins come from Chromium's DEPS, read by ay-deps (AY_DEPS names its binary); a new Chromium version moves all of them together.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chromiumDir, outDir } from "./home.ts";

const ROOT = resolve(import.meta.dir, "..");

export type Source = { name: string; repo: string; dep: string; package?: string; submodules?: string[] };
export type Tool = { name: string; source: string; kind: "go" | "cmake" | "copy" | "rust"; dir: string; main: string };
export type Registry = { version: string; windows: string; sources: Source[]; tools: Tool[] };
export type Dependency = { path: string; type: string; url?: string; rev?: string | null; packages?: string[] };

export function loadRegistry(file = join(ROOT, "ay-tools.toml")): Registry {
  const toml = Bun.TOML.parse(readFileSync(file, "utf8")) as { chromium: { version: string; windows: string; source: Source[]; tool: Tool[] } };
  return { version: toml.chromium.version, windows: toml.chromium.windows, sources: toml.chromium.source, tools: toml.chromium.tool };
}

/** The tools whose source is a Chromium source (the others are built from this repository). */
export const chromiumTools = (registry: Registry) => registry.tools.filter((tool) => tool.kind !== "rust");

/** The revision a source is pinned to, read from the DEPS dependency that names it. */
export function pinOf(source: Source, dependencies: Dependency[]): { ref: string; fromPackage?: string } {
  const dependency = dependencies.find((entry) => entry.path === source.dep);
  if (!dependency) throw new Error(`${source.name}: DEPS has no dependency ${source.dep}`);
  if (dependency.type === "git") {
    if (!dependency.rev) throw new Error(`${source.name}: ${source.dep} has no revision`);
    return { ref: dependency.rev };
  }
  const entry = (dependency.packages ?? []).find((name) => name.startsWith(source.package ?? "\0"));
  if (!entry) throw new Error(`${source.name}: no package starting with ${source.package} in ${source.dep}`);
  const version = entry.slice(entry.indexOf("@") + 1);
  const git = version.match(/^git_revision:([0-9a-f]{40})$/);
  if (git) return { ref: git[1]!, fromPackage: entry };
  // A third-party package built from a tagged upstream: `version:3@1.12.1.chromium.4` is upstream 1.12.1, tag v1.12.1.
  const tagged = version.match(/^version:\d+@(\d+(?:\.\d+)*)(?:\.chromium\.\d+)?$/);
  if (tagged) return { ref: `refs/tags/v${tagged[1]}`, fromPackage: entry };
  throw new Error(`${source.name}: cannot read a revision from ${entry}`);
}

export async function resolveDeps(version: string, base: string): Promise<Dependency[]> {
  const dir = chromiumDir(version, base);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "DEPS");
  if (!existsSync(file)) {
    const response = await fetch(`https://chromium.googlesource.com/chromium/src/+/refs/tags/${version}/DEPS?format=TEXT`);
    if (!response.ok) throw new Error(`DEPS of ${version}: ${response.status}`);
    writeFileSync(file, Buffer.from(await response.text(), "base64"));
  }
  const binary = Bun.env.AY_DEPS ?? "ay-deps";
  const run = Bun.spawnSync([binary, "list", file, "--os", "linux", "--cpu", "x64"], { stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`${binary}: ${run.stderr.toString().trim()}`);
  return (JSON.parse(run.stdout.toString()) as { deps: Dependency[] }).deps;
}

const sh = (command: string[], options: { cwd?: string; env?: Record<string, string | undefined> } = {}) => {
  const run = Bun.spawnSync(command, { cwd: options.cwd, env: { ...Bun.env, ...options.env }, stdout: "pipe", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`${command.slice(0, 3).join(" ")}: ${(run.stderr.toString() || run.stdout.toString()).trim().split("\n").slice(-3).join(" | ")}`);
  return run.stdout.toString().trim();
};

/** Fetches one repository at one ref (a commit or a tag), shallow, with the submodules the source asks for. */
export function fetchSource(source: Source, ref: string, dir: string): string {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, ".git"))) sh(["git", "init", "--quiet", dir]);
  const head = () => Bun.spawnSync(["git", "-C", dir, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" }).stdout.toString().trim();
  if (!(ref.startsWith("refs/") ? false : head() === ref)) {
    sh(["git", "-C", dir, "fetch", "--quiet", "--depth", "1", source.repo, ref]);
    sh(["git", "-C", dir, "checkout", "--quiet", "--force", "FETCH_HEAD"]);
  }
  for (const path of source.submodules ?? []) {
    const modules = readFileSync(join(dir, ".gitmodules"), "utf8");
    const url = modules.split(/\[submodule /).find((block) => block.includes(`path = ${path}\n`))?.match(/url = (.+)/)?.[1]?.trim();
    const pinned = sh(["git", "-C", dir, "ls-tree", "HEAD", path]).split(/\s+/)[2];
    if (!url || !pinned) throw new Error(`${source.name}: submodule ${path} is not described by .gitmodules`);
    fetchSource({ name: `${source.name}/${path}`, repo: url }, pinned, join(dir, path));
  }
  return head();
}

export function goBuild(tool: Tool, srcDir: string, out: string): string {
  const target = join(out, `${tool.name}.exe`);
  sh(["go", "build", "-trimpath", "-ldflags", "-s -w", "-o", target, tool.main], { cwd: join(srcDir, tool.dir), env: { GOOS: "windows", GOARCH: "amd64", CGO_ENABLED: "0" } });
  return target;
}

/** The CMake toolchain file for clang-cl against the Windows SDK and CRT that cargo-xwin caches (`xwin` is the cache's xwin directory). */
export function toolchainFile(xwin: string): string {
  const include = ["crt/include", "sdk/include/ucrt", "sdk/include/um", "sdk/include/shared", "sdk/include/winrt"].map((path) => `/imsvc ${xwin}/${path}`).join("\n    ");
  const libraries = ["crt/lib/x86_64", "sdk/lib/um/x86_64", "sdk/lib/ucrt/x86_64"].map((path) => `-libpath:"${xwin}/${path}"`).join("\n    ");
  return `set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR AMD64)
set(CMAKE_C_COMPILER clang-cl)
set(CMAKE_CXX_COMPILER clang-cl)
set(CMAKE_AR llvm-lib)
set(CMAKE_RC_COMPILER llvm-rc)
set(CMAKE_LINKER lld-link)
set(CMAKE_MSVC_RUNTIME_LIBRARY MultiThreaded)
set(COMPILE_FLAGS --target=x86_64-pc-windows-msvc -Wno-unused-command-line-argument -fuse-ld=lld-link
    ${include})
set(LINK_FLAGS /manifest:no
    ${libraries})
string(REPLACE ";" " " COMPILE_FLAGS "\${COMPILE_FLAGS}")
string(REPLACE ";" " " LINK_FLAGS "\${LINK_FLAGS}")
set(CMAKE_C_FLAGS_INIT "\${COMPILE_FLAGS}")
set(CMAKE_CXX_FLAGS_INIT "\${COMPILE_FLAGS} /EHsc")
set(CMAKE_EXE_LINKER_FLAGS_INIT "\${LINK_FLAGS}")
`;
}

/** CMake with clang-cl, the Windows SDK and CRT of cargo-xwin, a static CRT and thin LTO; the result is one self-contained .exe. */
export function cmakeBuild(tool: Tool, srcDir: string, out: string, xwin = join(homedir(), ".cache", "cargo-xwin", "xwin")): string {
  sh(["cargo", "xwin", "cache", "xwin"]);
  const source = join(srcDir, tool.dir);
  const build = join(source, ".build-windows");
  mkdirSync(build, { recursive: true });
  const toolchain = join(build, "windows-msvc.cmake");
  writeFileSync(toolchain, toolchainFile(xwin));
  sh([
    "cmake", "-S", source, "-B", build, "-G", "Ninja", `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`, "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_TESTING=OFF",
    "-DCMAKE_C_FLAGS_RELEASE=/O2 /DNDEBUG /clang:-flto=thin", "-DCMAKE_CXX_FLAGS_RELEASE=/O2 /DNDEBUG /clang:-flto=thin",
  ]);
  sh(["cmake", "--build", build, "--target", tool.main]);
  const target = join(out, `${tool.main}.exe`);
  sh(["cp", join(build, `${tool.main}.exe`), target]);
  return target;
}

/** This repository's own crates for Windows MSVC: cargo-xwin with clang-cl, the profile's fat LTO and one codegen unit, every .exe of the package. */
export function rustBuild(tool: Tool, windows: string, out: string, root = ROOT): string[] {
  sh(["cargo", "xwin", "build", "--release", "--target", windows, "-p", tool.main], { cwd: root });
  const release = join(Bun.env.CARGO_TARGET_DIR ?? join(root, "target"), windows, "release");
  const built = readdirSync(release).filter((file) => file.endsWith(".exe"));
  for (const file of built) sh(["cp", join(release, file), join(out, file)]);
  return built.map((file) => join(out, file));
}

/** A source tree as it is, without its git metadata (the Python tools of depot_tools). */
export function copyTree(tool: Tool, srcDir: string, out: string): string {
  const target = join(out, tool.name);
  mkdirSync(target, { recursive: true });
  sh(["bash", "-c", `tar -C ${JSON.stringify(join(srcDir, tool.dir))} --exclude=.git -cf - . | tar -C ${JSON.stringify(target)} -xf -`]);
  return target;
}

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));

export const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

if (import.meta.main) {
  const [command = "plan", ...names] = Bun.argv.slice(2);
  const registry = loadRegistry();
  const base = Bun.env.AY_TOOLS_HOME ?? (await import("./home.ts")).home();
  const out = outDir("windows-x64", base);
  const srcDir = (name: string) => join(chromiumDir(registry.version, base), "src", name);
  const dependencies = await resolveDeps(registry.version, base);
  const pins = new Map(registry.sources.map((source) => [source.name, pinOf(source, dependencies)]));
  if (command === "plan") {
    console.log(`Chromium ${registry.version}: ${dependencies.length} dependencies resolved`);
    for (const source of registry.sources) console.log(`${source.name.padEnd(16)} ${pins.get(source.name)!.ref.slice(0, 40).padEnd(42)} ${source.repo}${source.submodules ? `  + ${source.submodules.join(", ")}` : ""}`);
  } else if (command === "fetch") {
    for (const source of registry.sources.filter((entry) => names.length === 0 || names.includes(entry.name))) console.log(`${source.name.padEnd(16)} ${fetchSource(source, pins.get(source.name)!.ref, srcDir(source.name)).slice(0, 12)}`);
  } else if (command === "build") {
    mkdirSync(out, { recursive: true });
    for (const tool of registry.tools.filter((entry) => names.length === 0 || names.includes(entry.name))) {
      if (tool.kind === "go") console.log(`${tool.name.padEnd(16)} ${goBuild(tool, srcDir(tool.source), out)}`);
      else if (tool.kind === "rust") console.log(`${tool.name.padEnd(16)} ${rustBuild(tool, registry.windows, out).join(" ")}`);
      else if (tool.kind === "cmake") console.log(`${tool.name.padEnd(16)} ${cmakeBuild(tool, srcDir(tool.source), out)}`);
      else console.log(`${tool.name.padEnd(16)} ${copyTree(tool, srcDir(tool.source), out)}`);
    }
  } else if (command === "package") {
    const files = existsSync(out) ? walk(out).filter((file) => !file.endsWith("manifest.json")) : [];
    const manifest = { chromium: registry.version, target: registry.windows, files: files.map((file) => ({ path: file.slice(out.length + 1).replaceAll("\\", "/"), bytes: statSync(file).size, sha256: sha256(file) })) };
    writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`${manifest.files.length} files, ${manifest.files.reduce((sum, file) => sum + file.bytes, 0)} bytes -> ${join(out, "manifest.json")}`);
  } else {
    console.error("usage: chromium.ts plan | fetch [name ...] | build [tool ...] | package");
    process.exit(2);
  }
}
