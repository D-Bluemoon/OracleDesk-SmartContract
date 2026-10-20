//! Shared fixtures for the cross-contract integration tests.
//!
//! The clients in this crate are generated from the *compiled wasm* with
//! `contractimport!`, so `make build` must run before `cargo test` here. This
//! keeps the tests honest about the interface that actually ships and lets
//! `every_entrypoint_has_a_matrix_row` read the same wasm specs the host sees.

#[allow(clippy::too_many_arguments)]
pub mod market_core {
    soroban_sdk::contractimport!(file = "wasm/market_core.wasm");
}

#[allow(clippy::too_many_arguments)]
pub mod resolver {
    soroban_sdk::contractimport!(file = "wasm/resolver.wasm");
}

#[allow(clippy::too_many_arguments)]
pub mod treasury {
    soroban_sdk::contractimport!(file = "wasm/treasury.wasm");
}

#[allow(clippy::too_many_arguments)]
pub mod reasoning_registry {
    soroban_sdk::contractimport!(file = "wasm/reasoning_registry.wasm");
}

pub mod world;
