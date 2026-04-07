//! On-chain **round anchor** for Crash: binds `server_seed_hash` to a **round_id** (off-chain DB id or
//! sequence) so commitments are attributable. See `contract/protocol/STATE_LAYOUT.md`.
//!
//! Cell data (**40 bytes**): `[round_id: u64 LE][commitment: 32 bytes]` where `commitment` =
//! SHA-256 (raw) of UTF-8 `server_seed` — same as [`crash-seed-commit-sha256`] without round metadata.
//!
//! - **Mint:** group output cell data length **40**.
//! - **Spend:** witness 0 = `[round_id: u64 LE][UTF-8 server_seed]` (total length **9..=264**).
//!   Verifies `round_id` matches cell, then `SHA256(server_seed) == commitment`.

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

const DATA_LEN: usize = 8 + 32;
const MAX_SEED_UTF8: usize = 256;

#[repr(i8)]
enum ScriptError {
    WrongLength = 1,
    RoundMismatch = 2,
    HashMismatch = 3,
    Sys = 4,
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
        Err(ScriptError::RoundMismatch) => 2,
        Err(ScriptError::HashMismatch) => 3,
        Err(ScriptError::Sys) => 4,
    }
}

fn read_u64_le(b: &[u8]) -> u64 {
    u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
}

fn entry() -> Result<(), ScriptError> {
    if load_cell_data(0, Source::GroupInput).is_ok() {
        let data = load_cell_data(0, Source::GroupInput)?;
        if data.len() != DATA_LEN {
            return Err(ScriptError::WrongLength);
        }
        let cell_round = read_u64_le(&data[0..8]);
        let commitment = &data[8..DATA_LEN];

        let mut buf = [0u8; 8 + MAX_SEED_UTF8];
        let len = load_witness(&mut buf, 0, 0, Source::Input)?;
        if len < 9 || len > 8 + MAX_SEED_UTF8 {
            return Err(ScriptError::WrongLength);
        }
        let wit_round = read_u64_le(&buf[0..8]);
        if wit_round != cell_round {
            return Err(ScriptError::RoundMismatch);
        }
        verify_commit(commitment, &buf[8..len])?;
        return Ok(());
    }

    let output_data = load_cell_data(0, Source::GroupOutput)?;
    if output_data.len() != DATA_LEN {
        return Err(ScriptError::WrongLength);
    }
    Ok(())
}

fn verify_commit(commitment: &[u8], seed_utf8: &[u8]) -> Result<(), ScriptError> {
    let mut hasher = Sha256::new();
    hasher.update(seed_utf8);
    let h = hasher.finalize();
    if h[..] != commitment[..] {
        return Err(ScriptError::HashMismatch);
    }
    Ok(())
}
