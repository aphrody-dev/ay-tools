# ADR 0001: one build and workspace tool

## Context

The Aphrody repositories use five tools for what is one job, running a workspace's tasks reproducibly and fast: `just` for named
recipes, Turborepo for task graphs and caching, Bazel for hermetic builds (with `rules_rust` and `rules_cc`), and depot_tools plus the
Chrome Build Team's tools (`siso`, `gn` conventions in `chromium/build`) for the Chromium checkout. Each has its own file format, its own
cache and its own idea of a package, and none of them is a Rust library another tool can call.

Upstreams on GitHub are aphrody-labs forks and submodules here (`forks.toml`: `just`, `turborepo`, `bazel`, `rules_rust`, `rules_cc`). The
Chromium tools are not on GitHub: they are pinned references (`ay-tools.toml`) fetched as archives into `.cache/` for reading and for
parity tests.

## Decision

One binary, `ay`, and one Cargo workspace of `ay-tools-<domain>` crates, each carrying a row of `features.toml`:

| Crate | Takes from | Becomes |
| :-- | :-- | :-- |
| `ay-tools-just` | just | recipes, dotenv, imports and modules |
| `ay-tools-tasks` | turborepo | task graph over workspace packages, filters, watch, prune |
| `ay-tools-cache` | turborepo, bazel, siso | content-addressed store, task and action cache, REAPI client |
| `ay-tools-build` | bazel | build files, hermetic actions, queries, modules |
| `ay-tools-rust`, `ay-tools-cc` | rules_rust, rules_cc | the rules of both languages over the same build core |
| `ay-tools-ninja` | chromium/build, siso | GN files and a ninja-compatible executor |
| `ay-tools-deps` | depot_tools (gclient) | DEPS files: parse, resolve, then sync and hooks |
| `ay-tools-cl` | depot_tools (git cl) | upload, format, lint and land a change |
| `ay-tools-packages` | depot_tools (cipd), infra | pinned prebuilt packages |

A feature is done when its row names a proof. A tool is not ported by reading its manual: each crate is tested against the upstream
itself, on the same input, where one exists. `ay-tools-deps` is the first: `tools/parity.ts` compares its output on Chromium's real `DEPS`
(4,967 lines) with depot_tools' own `gclient_eval` for six targets, and the two agree on every dependency and hook.

## Build and delivery

- Rust 1.100.0 (`rust-toolchain.toml`, the Aphrody toolchain policy). The release profile is whole-program: fat LTO, one codegen unit,
  `panic = "abort"`, stripped symbols. Heavy builds and tests run on the build host, never on the PC.
- TypeScript tooling around the binary (references, parity, later the task runner's configuration front end) is compiled with
  `bun build --compile --bytecode --production`, Bun's ahead-of-time single-file executable.

## Consequences

- One cache and one graph replace five. Existing `justfile`, `turbo.json` and `DEPS` files keep working while their crates land, because
  each crate reads the upstream format.
- The forks stay unmodified submodules; ay-tools adds crates beside them and never copies their code.
- Starlark and the Bazel build language are the largest piece; `ay-tools-build` starts with the declarative subset the Aphrody
  repositories use, measured by `features.toml`, and grows by proof.
