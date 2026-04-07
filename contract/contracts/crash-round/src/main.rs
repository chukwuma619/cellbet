//! Unified **Crash round** type script (native CKB): commitment anchoring and escrow settlement
//! with **on-chain platform fee on wins only** (default 3%). Loss/forfeit sends the full stake to
//! the house with **no** platform take.
//!
//! # Escrow cell data **v2** (`state = 1`)
//! **148 bytes**:
//! `[1][1][round_id u64 LE][sha256_utf8 32][user_lock_hash 32][house_lock_hash 32][stake u64 LE][platform_lock_hash 32][fee_bps u16 LE]`  
//! `fee_bps` is basis points on **gross** cash-out (`user_payout + platform_payout`), e.g. `300` = 3%.
//!
//! - **Mint:** data length **148**; output **capacity** must equal **`stake`**.
//!
//! ## Spend — **forfeit / loss** (no fee, stake → house)
//! Witness: **2 bytes** `[0x00][house_output_idx u8]`  
//! Verifies: output at `house_output_idx` has capacity == input capacity and lock == `house_lock_hash`,  
//! and **no** output uses `user_lock_hash` or `platform_lock_hash`.
//!
//! ## Spend — **win** (fee taken before user receives; house funds net settlement)
//! Witness: **28 bytes** `[0x01][user_payout u64 LE][platform_payout u64 LE][house_payout u64 LE][u_idx u8][p_idx u8][h_idx u8]`  
//! Let `g = user_payout + platform_payout` (gross cash-out). Then:
//! - `platform_payout == (g * fee_bps) / 10000` (integer division),
//! - `user_payout == g - platform_payout`,
//! - outputs at the three indices match capacities and locks.  
//!   (Total CKB conservation is enforced by the chain; extra house inputs may fund wins.)
//!
//! **Witness format:** wallets use **WitnessArgs**; put payload in **`input_type`**.  
//! Raw witness (tests / tools) is still accepted when WitnessArgs parsing fails.

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use alloc::vec::Vec;

use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::prelude::*;
use ckb_std::error::SysError;
use ckb_std::high_level::{load_cell, load_cell_capacity, load_cell_data, load_witness_args};
use ckb_std::syscalls::load_witness;
use sha2::{Digest, Sha256};

const VERSION: u8 = 1;
const STATE_COMMIT: u8 = 0;
const STATE_ESCROW: u8 = 1;

const LEN_COMMIT: usize = 2 + 8 + 32;
const LEN_ESCROW: usize = 2 + 8 + 32 + 32 + 32 + 8 + 32 + 2;

const MAX_SEED_UTF8: usize = 256;

const WITNESS_FORFEIT: u8 = 0;
const WITNESS_WIN: u8 = 1;

#[repr(i8)]
enum ScriptError {
    WrongLength = 1,
    BadState = 2,
    RoundMismatch = 3,
    HashMismatch = 4,
    PayoutMismatch = 5,
    LockMismatch = 6,
    BadOutputIndex = 7,
    StakeCapacityMismatch = 8,
    BadFeeBps = 9,
    ForbiddenLockOnForfeit = 10,
    Sys = 11,
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
        Err(ScriptError::BadState) => 2,
        Err(ScriptError::RoundMismatch) => 3,
        Err(ScriptError::HashMismatch) => 4,
        Err(ScriptError::PayoutMismatch) => 5,
        Err(ScriptError::LockMismatch) => 6,
        Err(ScriptError::BadOutputIndex) => 7,
        Err(ScriptError::StakeCapacityMismatch) => 8,
        Err(ScriptError::BadFeeBps) => 9,
        Err(ScriptError::ForbiddenLockOnForfeit) => 10,
        Err(ScriptError::Sys) => 11,
    }
}

fn read_u64_le(b: &[u8]) -> u64 {
    u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
}

fn entry() -> Result<(), ScriptError> {
    if load_cell_data(0, Source::GroupInput).is_ok() {
        let data = load_cell_data(0, Source::GroupInput)?;
        if data.len() < 2 || data[0] != VERSION {
            return Err(ScriptError::WrongLength);
        }
        return match data[1] {
            STATE_COMMIT => spend_commit(&data),
            STATE_ESCROW => spend_escrow(&data),
            _ => Err(ScriptError::BadState),
        };
    }

    let out = load_cell_data(0, Source::GroupOutput)?;
    if out.len() < 2 || out[0] != VERSION {
        return Err(ScriptError::WrongLength);
    }
    match out[1] {
        STATE_COMMIT => mint_commit(&out),
        STATE_ESCROW => mint_escrow(&out),
        _ => Err(ScriptError::BadState),
    }
}

fn mint_commit(out: &[u8]) -> Result<(), ScriptError> {
    if out.len() != LEN_COMMIT {
        return Err(ScriptError::WrongLength);
    }
    Ok(())
}

fn mint_escrow(out: &[u8]) -> Result<(), ScriptError> {
    if out.len() != LEN_ESCROW {
        return Err(ScriptError::WrongLength);
    }
    let fee_bps = u16::from_le_bytes([out[146], out[147]]);
    if fee_bps > 10_000 {
        return Err(ScriptError::BadFeeBps);
    }
    let stake = read_u64_le(&out[106..114]);
    let cap = load_cell_capacity(0, Source::GroupOutput)?;
    if cap != stake {
        return Err(ScriptError::StakeCapacityMismatch);
    }
    Ok(())
}

fn spend_commit(data: &[u8]) -> Result<(), ScriptError> {
    if data.len() != LEN_COMMIT {
        return Err(ScriptError::WrongLength);
    }
    let cell_round = read_u64_le(&data[2..10]);
    let commitment = &data[10..42];

    let payload = load_witness_payload()?;
    if payload.len() < 9 || payload.len() > 8 + MAX_SEED_UTF8 {
        return Err(ScriptError::WrongLength);
    }
    let wit_round = read_u64_le(&payload[0..8]);
    if wit_round != cell_round {
        return Err(ScriptError::RoundMismatch);
    }
    verify_sha256(commitment, &payload[8..])?;
    Ok(())
}

/// Prefer WitnessArgs `input_type`; fallback to raw witness (mock tests).
fn load_witness_payload() -> Result<Vec<u8>, ScriptError> {
    match load_witness_args(0, Source::GroupInput) {
        Ok(args) => {
            let it = args.input_type();
            if it.is_none() {
                load_witness_raw()
            } else {
                match it.to_opt() {
                    Some(b) => Ok(b.as_slice().to_vec()),
                    None => load_witness_raw(),
                }
            }
        }
        Err(SysError::Encoding) => load_witness_raw(),
        Err(e) => Err(e.into()),
    }
}

fn load_witness_raw() -> Result<Vec<u8>, ScriptError> {
    let mut buf = [0u8; 512];
    let len = load_witness(&mut buf, 0, 0, Source::GroupInput)?;
    Ok(buf[..len].to_vec())
}

fn verify_sha256(commitment: &[u8], seed_utf8: &[u8]) -> Result<(), ScriptError> {
    let mut hasher = Sha256::new();
    hasher.update(seed_utf8);
    let h = hasher.finalize();
    if h[..] != commitment[..] {
        return Err(ScriptError::HashMismatch);
    }
    Ok(())
}

fn spend_escrow(data: &[u8]) -> Result<(), ScriptError> {
    if data.len() != LEN_ESCROW {
        return Err(ScriptError::WrongLength);
    }
    let user_hash = &data[42..74];
    let house_hash = &data[74..106];
    let platform_hash = &data[114..146];
    let fee_bps = u16::from_le_bytes([data[146], data[147]]) as u64;
    if fee_bps > 10_000 {
        return Err(ScriptError::BadFeeBps);
    }

    let cap_in = load_cell_capacity(0, Source::GroupInput)?;

    let payload = load_witness_payload()?;
    if payload.is_empty() {
        return Err(ScriptError::WrongLength);
    }

    match payload[0] {
        WITNESS_FORFEIT => {
            if payload.len() != 2 {
                return Err(ScriptError::WrongLength);
            }
            let house_idx = payload[1] as usize;
            verify_output_lock_and_cap(house_idx, cap_in, house_hash)?;
            ensure_no_output_with_lock(user_hash)?;
            ensure_no_output_with_lock(platform_hash)?;
            Ok(())
        }
        WITNESS_WIN => {
            if payload.len() != 28 {
                return Err(ScriptError::WrongLength);
            }
            let mut w = [0u8; 28];
            w.copy_from_slice(&payload[..28]);
            spend_escrow_win_parse(
                fee_bps,
                user_hash,
                house_hash,
                platform_hash,
                &w,
            )
        }
        _ => Err(ScriptError::WrongLength),
    }
}

fn spend_escrow_win_parse(
    fee_bps: u64,
    user_hash: &[u8],
    house_hash: &[u8],
    platform_hash: &[u8],
    w: &[u8; 28],
) -> Result<(), ScriptError> {
    let user_payout = read_u64_le(&w[1..9]);
    let platform_payout = read_u64_le(&w[9..17]);
    let house_payout = read_u64_le(&w[17..25]);
    let user_idx = w[25] as usize;
    let platform_idx = w[26] as usize;
    let house_idx = w[27] as usize;

    if user_idx == platform_idx || user_idx == house_idx || platform_idx == house_idx {
        return Err(ScriptError::BadOutputIndex);
    }

    let g = user_payout
        .checked_add(platform_payout)
        .ok_or(ScriptError::PayoutMismatch)?;
    let expected_platform = (g as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(ScriptError::PayoutMismatch)?
        / 10_000u128;
    let expected_platform_u64 = u64::try_from(expected_platform).map_err(|_| ScriptError::PayoutMismatch)?;
    let expected_user = g
        .checked_sub(expected_platform_u64)
        .ok_or(ScriptError::PayoutMismatch)?;

    if platform_payout != expected_platform_u64 || user_payout != expected_user {
        return Err(ScriptError::PayoutMismatch);
    }

    verify_output_lock_and_cap(user_idx, user_payout, user_hash)?;
    verify_output_lock_and_cap(platform_idx, platform_payout, platform_hash)?;
    verify_output_lock_and_cap(house_idx, house_payout, house_hash)?;
    Ok(())
}

fn ensure_no_output_with_lock(forbidden: &[u8]) -> Result<(), ScriptError> {
    let mut i = 0usize;
    loop {
        let cell = match load_cell(i, Source::Output) {
            Ok(c) => c,
            Err(SysError::IndexOutOfBound) => break,
            Err(e) => return Err(e.into()),
        };
        let h = cell.lock().calc_script_hash().raw_data();
        if h.as_ref() == forbidden {
            return Err(ScriptError::ForbiddenLockOnForfeit);
        }
        i += 1;
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
