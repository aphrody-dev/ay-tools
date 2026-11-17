# AGENTS.md

Contract for every agent working in ay-tools. Identity comes from `naming.toml`, sources from `ay-tools.toml` and `forks.toml`.

- Upstreams on GitHub are aphrody-labs forks (rust-mono's `tools/add.ts` and `fork.ts` with `--manifest forks.toml`) checked out by `tools/fetch.ts`
  outside this repository; Chromium's tools are fetched by `tools/chromium.ts` at the pins of the Chromium DEPS. No submodule, no `vendor/`, no
  `third_party/`, never a copy of an upstream in the tree. Everything fetched or built lives in the data directory (`tools/home.ts`).
- New code lives in `ay-tools-<domain>` crates, one per row group of `features.toml`, each with tests. A crate is tested against its upstream
  on the same input where an upstream exists (`tools/parity.ts` is the model). A feature row is `done` only with a `proof`.
- No data about the owner's machine or the fleet in tracked files. Heavy builds and every cargo run happen on the build host, not the PC.
- Work on `main`, commit by path, no branches, stash or reset, no AI attribution. Run `bun test tools` and, on the build host,
  `cargo test --workspace`, `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` before every push.
