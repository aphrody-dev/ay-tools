import { describe, expect, test } from "bun:test";
import { archiveUrl, cacheDir, loadReferences } from "./reference.ts";

describe("references", () => {
  test("the registry pins every reference to a full commit and names its license", () => {
    const references = loadReferences();
    expect(references.map((reference) => reference.name)).toEqual(["depot_tools", "chromium-build", "infra-build-2025-06", "infra"]);
    for (const reference of references) {
      expect(reference.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(reference.url).toStartWith("https://chromium.googlesource.com/");
      expect(reference.license).toBe("BSD-3-Clause");
    }
  });

  test("an archive URL names the repository, the commit and, when given, the path", () => {
    expect(archiveUrl({ url: "https://h/r", commit: "abc" })).toBe("https://h/r/+archive/abc.tar.gz");
    expect(archiveUrl({ url: "https://h/r", commit: "abc", path: "build" })).toBe("https://h/r/+archive/abc/build.tar.gz");
  });

  test("a reference is cached under .cache by its name", () => {
    expect(cacheDir({ name: "depot_tools" }, "/repo").replaceAll("\\", "/")).toBe("/repo/.cache/depot_tools");
  });
});
