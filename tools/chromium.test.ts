import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromiumTools, loadRegistry, pinOf, toolchainFile, type Dependency } from "./chromium.ts";
import { home } from "./home.ts";

const dependencies: Dependency[] = [
  { path: "src/third_party/depot_tools", type: "git", url: "https://chromium.googlesource.com/chromium/tools/depot_tools.git", rev: "ec77017fb3e090ff02bffb9c6980ebcdd3006ddc" },
  { path: "src/third_party/siso/cipd", type: "cipd", packages: ["build/siso/${platform}@git_revision:3025be9c477069426f08b8235e9545d5b20afd0f"] },
  { path: "src/third_party/ninja", type: "cipd", packages: ["infra/3pp/tools/ninja/${platform}@version:3@1.12.1.chromium.4"] },
  { path: "src/tools/luci-go", type: "cipd", packages: ["infra/tools/luci/cas/${platform}@git_revision:d84a4344b08a25658c6a7cd656f52252efaff7c1", "infra/tools/luci/isolate/${platform}@git_revision:d84a4344b08a25658c6a7cd656f52252efaff7c1"] },
];

describe("pins come from the DEPS of the pinned Chromium", () => {
  test("a git dependency is pinned to its revision", () => {
    expect(pinOf({ name: "depot_tools", repo: "r", dep: "src/third_party/depot_tools" }, dependencies).ref).toBe("ec77017fb3e090ff02bffb9c6980ebcdd3006ddc");
  });

  test("a cipd package built from a git revision is pinned to that revision", () => {
    expect(pinOf({ name: "build", repo: "r", dep: "src/third_party/siso/cipd", package: "build/siso/" }, dependencies).ref).toBe("3025be9c477069426f08b8235e9545d5b20afd0f");
    expect(pinOf({ name: "infra-luci", repo: "r", dep: "src/tools/luci-go", package: "infra/tools/luci/cas/" }, dependencies).ref).toBe("d84a4344b08a25658c6a7cd656f52252efaff7c1");
  });

  test("a third-party package at a chromium-patched version is pinned to the upstream tag", () => {
    expect(pinOf({ name: "ninja", repo: "r", dep: "src/third_party/ninja", package: "infra/3pp/tools/ninja/" }, dependencies).ref).toBe("refs/tags/v1.12.1");
  });

  test("a missing dependency, package or unreadable version is an error that names the source", () => {
    expect(() => pinOf({ name: "x", repo: "r", dep: "src/nope" }, dependencies)).toThrow("x: DEPS has no dependency src/nope");
    expect(() => pinOf({ name: "x", repo: "r", dep: "src/tools/luci-go", package: "other/" }, dependencies)).toThrow("no package starting with other/");
    expect(() => pinOf({ name: "x", repo: "r", dep: "d", package: "p/" }, [{ path: "d", type: "cipd", packages: ["p/x@latest"] }])).toThrow("cannot read a revision");
  });
});

describe("the registry", () => {
  const registry = loadRegistry();

  test("every tool names a source that exists, and every submodule path is a plain relative path", () => {
    const names = new Set(registry.sources.map((source) => source.name));
    for (const tool of chromiumTools(registry)) expect(names.has(tool.source)).toBe(true);
    expect(registry.tools.filter((tool) => tool.kind === "rust").map((tool) => tool.main)).toEqual(["ay-tools-deps"]);
    for (const source of registry.sources) for (const path of source.submodules ?? []) expect(path).toMatch(/^[\w.-]+(\/[\w.-]+)*$/);
  });

  test("the Windows target is the MSVC one and the version has the four numbers of a Chromium release", () => {
    expect(registry.windows).toBe("x86_64-pc-windows-msvc");
    expect(registry.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });
});

describe("home", () => {
  test("the environment wins, then the local file, then the platform's data directory", () => {
    const root = mkdtempSync(join(tmpdir(), "ay-tools-home-"));
    try {
      expect(home({ AY_TOOLS_HOME: root }, "linux", root)).toBe(root);
      expect(home({ XDG_DATA_HOME: "/data" }, "linux", root).replaceAll("\\", "/")).toEndWith("/data/aphrody/ay-tools");
      expect(home({ LOCALAPPDATA: "C:/Local" }, "win32", root).replaceAll("\\", "/")).toEndWith("Local/Aphrody/ay-tools");
      writeFileSync(join(root, "ay-tools.local.toml"), `home = ${JSON.stringify(join(root, "elsewhere"))}\n`);
      expect(home({}, "linux", root)).toBe(join(root, "elsewhere"));
      expect(home({ AY_TOOLS_HOME: root }, "linux", root)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the CMake toolchain file", () => {
  const file = toolchainFile("/cache/xwin");

  test("targets MSVC x86-64 with clang-cl, lld-link and a static CRT", () => {
    expect(file).toContain("set(CMAKE_SYSTEM_NAME Windows)");
    expect(file).toContain("--target=x86_64-pc-windows-msvc");
    expect(file).toContain("set(CMAKE_CXX_COMPILER clang-cl)");
    expect(file).toContain("set(CMAKE_LINKER lld-link)");
    expect(file).toContain("set(CMAKE_MSVC_RUNTIME_LIBRARY MultiThreaded)");
  });

  test("names the headers and libraries of the cached SDK and CRT, and keeps the CMake variable references literal", () => {
    for (const path of ["crt/include", "sdk/include/ucrt", "sdk/include/um", "sdk/include/shared"]) expect(file).toContain(`/imsvc /cache/xwin/${path}`);
    for (const path of ["crt/lib/x86_64", "sdk/lib/um/x86_64", "sdk/lib/ucrt/x86_64"]) expect(file).toContain(`-libpath:"/cache/xwin/${path}"`);
    expect(file).toContain('set(CMAKE_CXX_FLAGS_INIT "${COMPILE_FLAGS} /EHsc")');
  });
});
