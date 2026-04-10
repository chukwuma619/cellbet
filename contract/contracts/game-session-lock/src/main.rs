//! Pattern A — **Game session lock**: user key has full spend rights; backend key may spend only
//! if every non-change output is a crash escrow mint (house lock + configured type script).

#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
ckb_std::default_alloc!(16384, 1258306, 64);

use alloc::vec::Vec;

use ckb_hash::new_blake2b;
use ckb_std::ckb_constants::Source;
use ckb_std::ckb_types::core::ScriptHashType;
use ckb_std::ckb_types::packed::WitnessArgsReader;
use ckb_std::ckb_types::prelude::*;
use ckb_std::error::SysError;
use ckb_std::high_level::{load_cell, load_input, load_script, load_witness_args};
use ckb_std::syscalls::load_tx_hash;
use ckb_std::syscalls::load_witness;
use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

const ARGS_VERSION: u8 = 1;
const ARGS_LEN: usize = 1 + 20 + 20 + 32 + 32 + 1;
const SIGNATURE_SIZE: usize = 65;
const BACKEND_FLAG: u8 = 1;
#[repr(i8)]
enum ScriptError {
    ArgsLen = 1,
    ArgsVersion = 2,
    Witness = 3,
    Encoding = 4,
    Sig = 5,
    Blake160 = 6,
    Output = 7,
    Sys = 8,
    WitnessBound = 9,
}

impl From<SysError> for ScriptError {
    fn from(_: SysError) -> Self {
        ScriptError::Sys
    }
}

pub fn program_entry() -> i8 {
    match entry() {
        Ok(()) => 0,
        Err(ScriptError::ArgsLen) => 1,
        Err(ScriptError::ArgsVersion) => 2,
        Err(ScriptError::Witness) => 3,
        Err(ScriptError::Encoding) => 4,
        Err(ScriptError::Sig) => 5,
        Err(ScriptError::Blake160) => 6,
        Err(ScriptError::Output) => 7,
        Err(ScriptError::Sys) => 8,
        Err(ScriptError::WitnessBound) => 9,
    }
}

struct ParsedArgs {
    user_blake160: [u8; 20],
    backend_blake160: [u8; 20],
    house_lock_hash: [u8; 32],
    type_code_hash: [u8; 32],
    type_hash_type: u8,
}

fn parse_args(script_slice: &[u8]) -> Result<ParsedArgs, ScriptError> {
    use ckb_std::ckb_types::packed::ScriptReader;
    let script = ScriptReader::from_slice(script_slice).map_err(|_| ScriptError::Encoding)?;
    let raw = script.args().raw_data();
    let args = raw.as_ref();
    if args.len() != ARGS_LEN {
        return Err(ScriptError::ArgsLen);
    }
    if args[0] != ARGS_VERSION {
        return Err(ScriptError::ArgsVersion);
    }
    let mut user_blake160 = [0u8; 20];
    user_blake160.copy_from_slice(&args[1..21]);
    let mut backend_blake160 = [0u8; 20];
    backend_blake160.copy_from_slice(&args[21..41]);
    let mut house_lock_hash = [0u8; 32];
    house_lock_hash.copy_from_slice(&args[41..73]);
    let mut type_code_hash = [0u8; 32];
    type_code_hash.copy_from_slice(&args[73..105]);
    let type_hash_type = args[105];
    if !ScriptHashType::verify_value(type_hash_type) {
        return Err(ScriptError::ArgsVersion);
    }
    Ok(ParsedArgs {
        user_blake160,
        backend_blake160,
        house_lock_hash,
        type_code_hash,
        type_hash_type,
    })
}

fn count_inputs() -> Result<usize, ScriptError> {
    let mut i = 0usize;
    loop {
        match load_input(i, Source::Input) {
            Ok(_) => i += 1,
            Err(SysError::IndexOutOfBound) => return Ok(i),
            Err(_) => return Err(ScriptError::Sys),
        }
    }
}

fn load_witness_full(i: usize, source: Source) -> Result<Vec<u8>, ScriptError> {
    let mut buf = [0u8; 256];
    match load_witness(&mut buf, 0, i, source) {
        Ok(len) if len <= buf.len() => Ok(buf[..len].to_vec()),
        Ok(len) => {
            let mut v = alloc::vec![0u8; len];
            load_witness(&mut v, 0, i, source).map_err(|_| ScriptError::Sys)?;
            Ok(v)
        }
        Err(SysError::LengthNotEnough(actual)) => {
            let mut v = alloc::vec![0u8; actual];
            let loaded = load_witness(&mut v, 0, i, source).map_err(|_| ScriptError::Sys)?;
            if loaded != actual {
                return Err(ScriptError::Sys);
            }
            Ok(v)
        }
        Err(SysError::IndexOutOfBound) => Err(ScriptError::WitnessBound),
        Err(_) => Err(ScriptError::Sys),
    }
}

/// CKB `secp256k1_blake160_sighash_all` message (see ckb-system-scripts).
fn sighash_all_message() -> Result<[u8; 32], ScriptError> {
    let mut hasher = new_blake2b();
    let mut tx_hash = [0u8; 32];
    let n = load_tx_hash(&mut tx_hash, 0).map_err(|_| ScriptError::Sys)?;
    if n != 32 {
        return Err(ScriptError::Sys);
    }
    hasher.update(&tx_hash);

    let mut w = load_witness_full(0, Source::GroupInput)?;
    let (start, lock_len) = {
        let reader = WitnessArgsReader::from_slice(&w).map_err(|_| ScriptError::Encoding)?;
        let lock_reader = reader.lock();
        if !lock_reader.is_some() {
            return Err(ScriptError::Witness);
        }
        let lock_inner = lock_reader.to_opt().ok_or(ScriptError::Witness)?;
        let lock_sl = lock_inner.as_slice();
        let base = w.as_ptr() as usize;
        let start = lock_sl.as_ptr() as usize - base;
        if start + lock_sl.len() > w.len() {
            return Err(ScriptError::Witness);
        }
        (start, lock_sl.len())
    };
    w[start..start + lock_len].fill(0);

    let witness_len = w.len() as u64;
    hasher.update(&witness_len.to_le_bytes());
    hasher.update(&w);

    let mut i = 1usize;
    loop {
        match load_witness_full(i, Source::GroupInput) {
            Ok(next) => {
                let len = next.len() as u64;
                hasher.update(&len.to_le_bytes());
                hasher.update(&next);
                i += 1;
            }
            Err(ScriptError::WitnessBound) => break,
            Err(e) => return Err(e),
        }
    }

    let n_in = count_inputs()?;
    let mut j = n_in;
    loop {
        match load_witness_full(j, Source::Input) {
            Ok(next) => {
                let len = next.len() as u64;
                hasher.update(&len.to_le_bytes());
                hasher.update(&next);
                j += 1;
            }
            Err(ScriptError::WitnessBound) => break,
            Err(e) => return Err(e),
        }
    }

    let mut msg = [0u8; 32];
    hasher.finalize(&mut msg);
    Ok(msg)
}

fn blake160_pubkey_compressed(pubkey33: &[u8]) -> Result<[u8; 20], ScriptError> {
    if pubkey33.len() != 33 {
        return Err(ScriptError::Blake160);
    }
    let mut hasher = new_blake2b();
    hasher.update(pubkey33);
    let mut out = [0u8; 32];
    hasher.finalize(&mut out);
    let mut b160 = [0u8; 20];
    b160.copy_from_slice(&out[..20]);
    Ok(b160)
}

fn verify_secp256k1_blake160(
    message: &[u8; 32],
    sig_bytes: &[u8],
    expected_blake160: &[u8; 20],
) -> Result<(), ScriptError> {
    if sig_bytes.len() != SIGNATURE_SIZE {
        return Err(ScriptError::Sig);
    }
    let sig =
        Signature::from_slice(&sig_bytes[..64]).map_err(|_| ScriptError::Sig)?;
    let rec = RecoveryId::try_from(sig_bytes[64]).map_err(|_| ScriptError::Sig)?;
    let vk = VerifyingKey::recover_from_prehash(message.as_slice(), &sig, rec)
        .map_err(|_| ScriptError::Sig)?;
    let enc = vk.to_encoded_point(true);
    let pk = enc.as_bytes();
    let got = blake160_pubkey_compressed(pk)?;
    if got != *expected_blake160 {
        return Err(ScriptError::Blake160);
    }
    Ok(())
}

fn output_is_session_change(
    idx: usize,
    session_script_slice: &[u8],
) -> Result<bool, ScriptError> {
    let cell = load_cell(idx, Source::Output)?;
    let lock = cell.lock();
    let out_lock = lock.as_slice();
    Ok(out_lock == session_script_slice)
}

fn output_is_allowed_escrow(
    idx: usize,
    parsed: &ParsedArgs,
    session_script_slice: &[u8],
) -> Result<bool, ScriptError> {
    if output_is_session_change(idx, session_script_slice)? {
        return Ok(false);
    }
    let cell = load_cell(idx, Source::Output)?;
    let lock_h = cell.lock().calc_script_hash();
    if lock_h.as_slice() != parsed.house_lock_hash {
        return Ok(false);
    }
    let type_opt = cell.type_().to_opt();
    let Some(ts) = type_opt else {
        return Ok(false);
    };
    if ts.code_hash().as_slice() != parsed.type_code_hash {
        return Ok(false);
    }
    let ht: u8 = ts.hash_type().into();
    if ht != parsed.type_hash_type {
        return Ok(false);
    }
    Ok(true)
}

fn verify_backend_outputs(
    parsed: &ParsedArgs,
    session_script_slice: &[u8],
) -> Result<(), ScriptError> {
    let mut i = 0usize;
    loop {
        let cell = match load_cell(i, Source::Output) {
            Ok(c) => c,
            Err(SysError::IndexOutOfBound) => break,
            Err(_) => return Err(ScriptError::Sys),
        };
        let _ = cell;
        let is_change = output_is_session_change(i, session_script_slice)?;
        let is_escrow = output_is_allowed_escrow(i, parsed, session_script_slice)?;
        if !is_change && !is_escrow {
            return Err(ScriptError::Output);
        }
        i += 1;
    }
    if i == 0 {
        return Err(ScriptError::Output);
    }
    Ok(())
}

fn entry() -> Result<(), ScriptError> {
    let script = load_script()?;
    let script_slice = script.as_slice();
    let parsed = parse_args(script_slice)?;

    let wa = load_witness_args(0, Source::GroupInput)?;
    let lock_entity = wa.lock();
    if !lock_entity.is_some() {
        return Err(ScriptError::Witness);
    }
    let lock_bytes = lock_entity.to_opt().ok_or(ScriptError::Witness)?;
    let lb = lock_bytes.as_slice();

    let msg = sighash_all_message()?;

    if lb.len() == SIGNATURE_SIZE {
        verify_secp256k1_blake160(&msg, lb, &parsed.user_blake160)?;
        return Ok(());
    }

    if lb.len() == SIGNATURE_SIZE + 1 && lb[0] == BACKEND_FLAG {
        verify_secp256k1_blake160(&msg, &lb[1..], &parsed.backend_blake160)?;
        verify_backend_outputs(&parsed, script_slice)?;
        return Ok(());
    }

    Err(ScriptError::Witness)
}
