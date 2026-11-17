# ay-tools

One build and workspace tool in Rust, assembled from the tools the Aphrody repositories used to run side by side: `just`, Turborepo,
Bazel with `rules_rust` and `rules_cc`, depot_tools and the Chrome Build Team's tools. Decision and crate map: [ADR 0001](docs/adr/0001-one-build-tool.md).
The features of the merged tools are rows of [`features.toml`](features.toml); a row is done only with a proof.

| Part | State |
| :-- | :-- |
| Upstreams | forks of `just`, `turborepo`, `bazel`, `rules_rust`, `rules_cc` ([`forks.toml`](forks.toml)), checked out as folders outside this repository (`bun tools/fetch.ts forks`); no submodule, no vendored or third-party directory |
| Chromium tools | siso, cas, isolate, swarming, result_adapter, ninja and depot_tools, fetched at the revisions the DEPS of Chromium 160.0.8166.0 names and cross-compiled for Windows MSVC from the build host (`bun tools/chromium.ts plan\|fetch\|build\|package`); published to Cloudflare R2 by the `windows` workflow and served by `workers/release` |
| `ay-tools-deps` | gclient's `DEPS`: parse, conditions, variables, dependencies and hooks per target. Identical to depot_tools' `gclient_eval` on Chromium's DEPS for six targets |
| The other crates | planned, see the matrix |

```sh
bun tools/fetch.ts forks                           # the forks, outside the repository
bun tools/chromium.ts plan                         # every Chromium source with the pin its DEPS names
bun tools/reference.ts fetch                       # the pinned reference trees into .cache/ (parity tests)
cargo run -p ay-tools-deps -- list DEPS --os android --cpu arm64
bun tools/parity.ts <ay-deps> <DEPS> .cache/depot_tools
```

Cargo builds and tests run on the build host.
