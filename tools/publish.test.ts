import { expect, test } from "bun:test";
import { BUCKET, keysOf } from "./publish.ts";

test("a build is published under its Chromium version, with the manifest last and a pointer to it", () => {
  const { prefix, keys, latest } = keysOf("160.0.8166.0", [
    { path: "siso.exe", bytes: 1, sha256: "a" },
    { path: "depot_tools/gclient.py", bytes: 2, sha256: "b" },
  ]);
  expect(BUCKET).toBe("aphrody-chromium");
  expect(prefix).toBe("ay-tools/160.0.8166.0/windows-x64");
  expect(keys.map((entry) => entry.key)).toEqual([`${prefix}/siso.exe`, `${prefix}/depot_tools/gclient.py`, `${prefix}/manifest.json`]);
  expect(latest).toBe("ay-tools/latest.json");
});
