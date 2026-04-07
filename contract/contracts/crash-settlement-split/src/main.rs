//! **Settlement split** type script (Phase 1): one escrow cell locks CKB under this type; spending
//! splits **100%** of that cell’s capacity into two outputs with **predetermined lock scripts**
//! (player vs house/treasury). See `contract/protocol/STATE_LAYOUT.md` and `LOCKS.md`.
//!
//! Cell data (**80 bytes**):
//! - `[0..8)` `round_id` u64 LE (metadata; not cryptographically verified against L2 here)
//! - `[8..40)` `user_lock_hash` — `blake2b_256(lock_script.as_slice())` per CKB convention
//! - `[40..72)` `house_lock_hash`
//! - `[72..80)` `flags` u64 LE (reserved; must be **0** in v1)
//!
//! **Mint:** group output data length **80**, `flags == 0`.
//!
//! **Spend:** witness 0 = **18 bytes**:
//! - `[0..8)` `user_payout` u64 LE (shannons to user output)
//! - `[8..16)` `house_payout` u64 LE (shannons to house output)
//! - `[16)` `user_output_index` u8
//! - `[17)` `house_output_index` u8
//!
//! Verifies `user_payout + house_payout ==` input cell capacity, output at `user_output_index` has
//! capacity `user_payout` and lock hash matches `user_lock_hash` (same for house). **No inflation:**
//! payouts cannot exceed the spent cell’s capacity.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::prelude::*;
use ckb_std::error::SysError;
use ckb_std::high_level::{load_cell, load_cell_capacity, load_cell_data};
use ckb_std::syscalls::load_witness;

const DATA_LEN: usize = 80;
const WITNESS_LEN: usize = 18;

#[repr(i8)]
enum ScriptError {
    WrongLength = 1,
    BadFlags = 2,
    PayoutMismatch = 3,
    LockMismatch = 4,
    BadOutputIndex = 5,
    Sys = 6,
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
        Err(ScriptError::BadFlags) => 2,
        Err(ScriptError::PayoutMismatch) => 3,
        Err(ScriptError::LockMismatch) => 4,
        Err(ScriptError::BadOutputIndex) => 5,
        Err(ScriptError::Sys) => 6,
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
        let _round_id = read_u64_le(&data[0..8]);
        let user_hash = &data[8..40];
        let house_hash = &data[40..72];
        let flags = read_u64_le(&data[72..80]);
        if flags != 0 {
            return Err(ScriptError::BadFlags);
        }

        let cap_in = load_cell_capacity(0, Source::GroupInput)?;
        let mut w = [0u8; WITNESS_LEN];
        let wlen = load_witness(&mut w, 0, 0, Source::Input)?;
        if wlen != WITNESS_LEN {
            return Err(ScriptError::WrongLength);
        }
        let user_payout = read_u64_le(&w[0..8]);
        let house_payout = read_u64_le(&w[8..16]);
        let user_idx = w[16] as usize;
        let house_idx = w[17] as usize;

        let sum = user_payout
            .checked_add(house_payout)
            .ok_or(ScriptError::PayoutMismatch)?;
        if sum != cap_in {
            return Err(ScriptError::PayoutMismatch);
        }

        if user_idx == house_idx {
            return Err(ScriptError::BadOutputIndex);
        }

        verify_output_lock_and_cap(user_idx, user_payout, user_hash)?;
        verify_output_lock_and_cap(house_idx, house_payout, house_hash)?;
        return Ok(());
    }

    let out_data = load_cell_data(0, Source::GroupOutput)?;
    if out_data.len() != DATA_LEN {
        return Err(ScriptError::WrongLength);
    }
    let flags = read_u64_le(&out_data[72..80]);
    if flags != 0 {
        return Err(ScriptError::BadFlags);
    }
    Ok(())
}

fn verify_output_lock_and_cap(
    index: usize,
    expected_cap: u64,
    expected_lock_hash: &[u8],
) -> Result<(), ScriptError> {
    let cell = load_cell(index, Source::Output)?;
    let cap = cell.capacity().unpack();
    if cap != expected_cap {
        return Err(ScriptError::PayoutMismatch);
    }
    let h = cell.lock().calc_script_hash().raw_data();
    if h.as_ref() != expected_lock_hash {
        return Err(ScriptError::LockMismatch);
    }
    Ok(())
}
