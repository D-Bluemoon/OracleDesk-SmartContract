# Contributing to OracleDesk (Stellar)

Thanks for considering contributing. This is a testnet-only, unaudited,
pre-alpha project — see `docs/STATUS.md` for exactly what works today.

## Dev setup

```bash
git clone <this repo>
cd oracledesk-stellar
make setup   # npm install in x402/, agents/, packages/bindings/*
make build   # cargo build + stellar contract build
make test    # cargo test + model/fpmm_model.py + x402 tests
```

You'll need Rust at the version pinned in `rust-toolchain.toml` (exact, not
`stable`) with the `wasm32v1-none` target — `rustup` reads that file
automatically — the [Stellar CLI](https://developers.stellar.org/docs/tools/cli)
at the version pinned in `stellar-cli.version`, Node 20+, Python 3.10+, and
`jq`.

## Branch and commit conventions

- Branch names: `feat/...`, `fix/...`, `docs/...`, `chore/...`.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/) —
  `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`. Keep them small
  and scoped to one logical change.
- No force-pushes to shared branches.

## Running the test suites

```bash
cargo test --workspace                          # all 4 contracts
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings
python3 model/fpmm_model.py                      # FPMM math property tests
cd x402 && npm test                              # x402 trace API
make formal                                      # TLC model check (needs Java)
cd agents && npm test                            # FPMM (BigInt), trace, strategy, adapter
```

Contract changes need:

- A test for every new state transition.
- A non-mocked-auth test proving the wrong caller is rejected, for every
  privileged function (see `wrong_caller_cannot_*` tests across
  `contracts/*/src/lib.rs` for the pattern — `env.set_auths(&[])` plus
  `mock_auths` for a specific *other* address, not `mock_all_auths`, which
  would hide a missing `require_auth`).
- If the change touches `market-core` or `reasoning-registry`, refresh the
  vendored copies and their committed `.sha256` pins with
  `./scripts/sync-vendored-wasm.sh` (or just `make build`, which does it in
  the right order) before those crates will see the change. A stale copy is a
  **compile error** now: each dependent crate's `build.rs` verifies the
  vendored bytes against `<name>.wasm.sha256`, so you can no longer silently
  build against an old interface. `make verify-wasm` proves the build is
  reproducible and the pins match a clean build. See
  [docs/adr/0002-cross-contract-calls.md](docs/adr/0002-cross-contract-calls.md).

## Coverage

```bash
cargo install --locked cargo-llvm-cov --version 0.9.1 && rustup component add llvm-tools-preview
make setup && make coverage     # coverage/lcov.info + coverage/html/index.html
make coverage-gate              # enforce coverage/thresholds.json
```

CI uploads the same report as the `coverage` artifact and fails a PR when a
package falls below its minimum in `coverage/thresholds.json` or drops more than
0.5 points against `develop`. If you add tests that raise a package well above
its minimum, raise the minimum in the same PR. See [coverage/README.md](coverage/README.md)
for what is measured, why market-core is registered both as wasm and natively in
the resolver and treasury tests (`MARKET_CORE_IMPL`, `both_modes!`), and how to
read the numbers. Node 20.19+ or 22.12+ is required (c8).

## Formal checks and exhaustive tests

`make formal` model-checks the resolution lifecycle ([docs/formal/](docs/formal/README.md)),
`python3 model/fpmm_bounds.py --quick` checks the FPMM economics claims
([docs/fpmm-economics.md](docs/fpmm-economics.md)), and
`cargo test -p integration-tests treasury_caps_exhaustive` searches the treasury's
spending caps ([architecture.md](docs/architecture.md#treasury-cap-guarantees);
about 2 minutes on 8 cores, `TREASURY_SEARCH_DEPTH=5` for a quick run).

## Code style

- Rust: `cargo fmt` (rustfmt defaults) and a clean `clippy -D warnings`.
- TypeScript: no linter is configured yet (see `docs/wave-issues/`) —
  follow the style already in the file you're editing.
- Doc comments explain *why*, not *what* — see the existing contract source
  for the level of comment density we're going for (sparse, but present at
  every non-obvious invariant).

## Pull request checklist

- [ ] `cargo fmt --check` and `cargo clippy --workspace --all-targets -- -D
      warnings` both pass.
- [ ] `cargo test --workspace` passes.
- [ ] If you touched contract interfaces, bindings were regenerated
      (`make bindings`) and the diff is included.
- [ ] If you touched `market-core` or `reasoning-registry`, the vendored wasm
      copies and their `.sha256` pins were refreshed (`make build` /
      `./scripts/sync-vendored-wasm.sh`), and `make verify-wasm` passes.
- [ ] New behavior has a test; changed behavior's existing test was updated,
      not deleted.
- [ ] `docs/STATUS.md` updated if this changes what's verified/unverified.

## Issues and how to ask for one

Issues are scoped as files in `docs/wave-issues/NN-title.md` before being
filed to GitHub (each has context, files to touch, acceptance criteria, how
to test, and a complexity label). If you want to work on one, comment on the
filed GitHub issue (once filed) to claim it, or open a new issue referencing
the relevant `docs/wave-issues/` file if it hasn't been filed yet.

<!-- TODO(maintainer): state an expected review turnaround here once you
have one — not committing to a number without your input. -->

## Reporting security issues

Do not open a public issue for a security vulnerability — see
[SECURITY.md](SECURITY.md).
