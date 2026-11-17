// Where ay-tools keeps what it fetches. Nothing fetched lives inside this repository: forks, Chromium sources and build outputs are
// folders of one data directory, chosen by AY_TOOLS_HOME, then by `home` in the git-ignored ay-tools.local.toml, then by the platform's
// per-user data directory (the same scheme as the other Aphrody tools: <data dir>/aphrody/ay-tools).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

export type Env = Record<string, string | undefined>;

export function home(env: Env = Bun.env, platform: string = process.platform, root: string = ROOT): string {
  if (env.AY_TOOLS_HOME) return resolve(env.AY_TOOLS_HOME);
  const local = join(root, "ay-tools.local.toml");
  if (existsSync(local)) {
    const configured = (Bun.TOML.parse(readFileSync(local, "utf8")) as { home?: string }).home;
    if (configured) return resolve(configured);
  }
  if (platform === "win32") return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Aphrody", "ay-tools");
  return join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "aphrody", "ay-tools");
}

export const forksDir = (base = home()) => join(base, "forks");
export const chromiumDir = (version: string, base = home()) => join(base, "chromium", version);
export const outDir = (target: string, base = home()) => join(base, "out", target);
