//! Type script aligned with off-chain Crash **§4.9**: `server_seed_hash` is **SHA-256** (raw 32 bytes
//! in cell data) of the **UTF-8** `server_seed` string (same as `sha256HexUtf8` in `@cellbet/shared`).
//!
//! - **Mint:** group output cell data must be exactly **32 bytes** (the commitment).
//! - **Spend:** witness 0 for input 0 is the **UTF-8 bytes** of `server_seed` (length **1..=256**).
//!   Script checks `SHA256(witness) == commitment`.
//!
//! This matches the backend’s `randomServerSeed()` (64-char hex string) and proof verification.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use ckb_std::ckb_constants::Source;
use ckb_std::error::SysError;
use ckb_std::high_level::load_cell_data;
use ckb_std::syscalls::load_witness;
use sha2::{Digest, Sha256};

const COMMITMENT_BYTES: usize = 32;
/// Max UTF-8 length for `server_seed` (backend today uses 64-char hex = 64 bytes).
const MAX_WITNESS_LEN: usize = 256;

#[repr(i8)]
enum ScriptError {
    WrongLength = 1,
    HashMismatch = 2,
    Sys = 3,
}

impl From<SysError> for ScriptError {
    fn from(_: SysError) -> Self {
        ScriptError::Sys
    }
}

pub fn program_entry() -> i8 {
    match entry() {
        Ok(()) => 0,
        Err(ScriptError::WrongLength) => 1,
        Err(ScriptError::HashMismatch) => 2,
        Err(ScriptError::Sys) => 3,
    }
}

fn entry() -> Result<(), ScriptError> {
    if load_cell_data(0, Source::GroupInput).is_ok() {
        let commitment = load_cell_data(0, Source::GroupInput)?;
        if commitment.len() != COMMITMENT_BYTES {
            return Err(ScriptError::WrongLength);
        }
        let mut buf = [0u8; MAX_WITNESS_LEN];
        let len = load_witness(&mut buf, 0, 0, Source::Input)?;
        if len == 0 || len > MAX_WITNESS_LEN {
            return Err(ScriptError::WrongLength);
        }
        verify_reveal(&commitment, &buf[..len])?;
        return Ok(());
    }

    let output_data = load_cell_data(0, Source::GroupOutput)?;
    if output_data.len() != COMMITMENT_BYTES {
        return Err(ScriptError::WrongLength);
    }
    Ok(())
}

fn verify_reveal(commitment: &[u8], preimage_utf8: &[u8]) -> Result<(), ScriptError> {
    let mut hasher = Sha256::new();
    hasher.update(preimage_utf8);
    let h = hasher.finalize();
    if h[..] != commitment[..] {
        return Err(ScriptError::HashMismatch);
    }
    Ok(())
}
