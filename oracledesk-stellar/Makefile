.PHONY: setup build test lint fmt deploy-testnet seed-market demo bindings verify-wasm check-wasm clean

# Installs Node dependencies for the TypeScript packages. Rust toolchain,
# the `stellar` CLI, and Python 3 are expected to already be on PATH — see
# README.md's Prerequisites section.
# Bindings must be installed *and built* (dist/index.d.ts etc.) before
# agents/ and x402/ install, since both depend on them by local file: path
# and need real type declarations, not just a package.json, to typecheck.
setup:
	for pkg in market-core resolver treasury reasoning-registry timelock router; do \
		(cd packages/bindings/$$pkg && npm install && npm run build) || exit 1; \
	done
	cd agents && npm install
	cd x402 && npm install

# Builds all four Soroban contracts to wasm via the Stellar CLI. The vendored
# cross-contract copies (resolver/treasury's market_core.wasm, resolver's
# reasoning_registry.wasm) are refreshed by scripts/sync-vendored-wasm.sh and
# then re-verified by each crate's build.rs against the committed `.sha256`
# pin (see docs/adr/0002-cross-contract-calls.md — a stale copy is a compile
# error, not a silent old interface).
build:
	cargo build --workspace
	stellar contract build
	./scripts/sync-vendored-wasm.sh
	stellar contract build
	cp target/wasm32v1-none/release/market_core.wasm contracts/integration-tests/wasm/
	cp target/wasm32v1-none/release/resolver.wasm contracts/integration-tests/wasm/
	cp target/wasm32v1-none/release/treasury.wasm contracts/integration-tests/wasm/
	cp target/wasm32v1-none/release/reasoning_registry.wasm contracts/integration-tests/wasm/

# Proves the contract build is bit-for-bit reproducible and that the vendored
# wasm matches a clean build (issue #58). Slow: it compiles the workspace
# twice into separate target directories.
verify-wasm:
	./scripts/check-wasm-determinism.sh

# Same check, but only against the current target dir (no clean rebuild).
check-wasm:
	./scripts/sync-vendored-wasm.sh
	git diff --exit-code -- \
		contracts/resolver/market_core.wasm contracts/treasury/market_core.wasm \
		contracts/resolver/reasoning_registry.wasm \
		contracts/resolver/market_core.wasm.sha256 \
		contracts/treasury/market_core.wasm.sha256 \
		contracts/resolver/reasoning_registry.wasm.sha256

test: build
	cargo test --workspace
	cargo test --manifest-path scripts/spec-hash/Cargo.toml
	python3 model/fpmm_model.py
	python3 model/system_model.py --selftest
	cd x402 && npm test
	cd agents && npm test

lint:
	./scripts/check-no-mock-all-auths.sh
	cargo fmt --check
	cargo clippy --workspace --all-targets -- -D warnings

auth-matrix: build
	cargo test -p integration-tests --test auth_matrix
	./scripts/check-no-mock-all-auths.sh

kani:
	cargo kani -p market-core

model-test:
	python3 model/system_model.py --selftest
	cargo test -p integration-tests --test system_model

e2e-local:
	./scripts/e2e-local.sh

fmt:
	cargo fmt

deploy-testnet: build
	./scripts/deploy-testnet.sh

seed-market:
	./scripts/seed-market.sh

demo:
	./scripts/demo.sh

bindings: build
	./scripts/gen-bindings.sh

clean:
	cargo clean
	rm -rf x402/node_modules agents/node_modules
	rm -rf packages/bindings/*/node_modules packages/bindings/*/dist
