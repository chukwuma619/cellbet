//! Phase 1 type script: 32-byte **BLAKE2b-256** commitment in cell data; spend requires
//! witness 0 for input 0 to be **exactly 32 bytes** (raw preimage) with
//! `Blake2b256(preimage) == commitment`.
//!
//! Off-chain Crash uses SHA-256 for `server_seed_hash` today; align on-chain commits to
//! BLAKE2b-256 of the same 32-byte seed material, or bridge in a follow-up script.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use blake2::{Blake2b, Digest};
use ckb_std::ckb_constants::Source;
use ckb_std::error::SysError;
use ckb_std::high_level::load_cell_data;
use ckb_std::syscalls::load_witness;
use digest::consts::U32;

const COMMITMENT_BYTES: usize = 32;
const PREIMAGE_BYTES: usize = 32;

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
        let mut preimage = [0u8; PREIMAGE_BYTES];
        let len = load_witness(&mut preimage, 0, 0, Source::Input)?;
        if len != PREIMAGE_BYTES {
            return Err(ScriptError::WrongLength);
        }
        verify_reveal(&commitment, &preimage)?;
        return Ok(());
    }

    let output_data = load_cell_data(0, Source::GroupOutput)?;
    if output_data.len() != COMMITMENT_BYTES {
        return Err(ScriptError::WrongLength);
    }
    Ok(())
}

fn verify_reveal(commitment: &[u8], preimage: &[u8]) -> Result<(), ScriptError> {
    if commitment.len() != COMMITMENT_BYTES || preimage.len() != PREIMAGE_BYTES {
        return Err(ScriptError::WrongLength);
    }
    let mut hasher = Blake2b::<U32>::new();
    hasher.update(preimage);
    let h = hasher.finalize();
    if h[..] != commitment[..] {
        return Err(ScriptError::HashMismatch);
    }
    Ok(())
}
