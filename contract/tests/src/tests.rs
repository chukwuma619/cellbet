//! Integration tests for `crash-commit-reveal`: mint (32-byte commitment in output data)
//! and spend (witness 0 = 32-byte preimage; BLAKE2b-256 must match).
//!
//! Build the RISC-V binary first: `make -C contract/contracts/crash-commit-reveal build`,
//! which copies the artifact to `contract/build/release/crash-commit-reveal`.

use blake2::{Blake2b, Digest};
use ckb_testtool::builtin::ALWAYS_SUCCESS;
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::{ScriptHashType, TransactionBuilder},
    packed::{CellInput, CellOutput},
    prelude::*,
};
use ckb_testtool::context::Context;
use digest::consts::U32;
use sha2::Sha256;

use crate::verify_and_dump_failed_tx;

const MAX_CYCLES: u64 = 70_000_000;

fn blake2b256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Blake2b::<U32>::new();
    hasher.update(data);
    hasher.finalize().into()
}

fn deploy_scripts(
    context: &mut Context,
) -> (
    ckb_testtool::ckb_types::packed::Script,
    ckb_testtool::ckb_types::packed::Script,
) {
    let crash_op = context.deploy_cell_by_name("crash-commit-reveal");
    let always_op = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let type_script = context
        .build_script_with_hash_type(&crash_op, ScriptHashType::Data1, Bytes::default())
        .expect("type script");
    let lock_script = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::default())
        .expect("lock script");
    (type_script, lock_script)
}

#[test]
fn crash_mint_valid_commitment_passes() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_scripts(&mut context);

    let fund = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000_000_000u64)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );

    let preimage = [7u8; 32];
    let commitment = blake2b256(&preimage);

    let output = CellOutput::new_builder()
        .capacity(900_000_000_000u64)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(fund)
                .build(),
        )
        .output(output)
        .output_data(Bytes::from(commitment.to_vec()).pack())
        .witness(Bytes::new().pack())
        .build();
    let tx = context.complete_tx(tx);
    verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES).expect("mint should pass");
}

#[test]
fn crash_mint_wrong_output_length_fails() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_scripts(&mut context);

    let fund = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000_000_000u64)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );

    let bad_data = vec![0u8; 31];
    let output = CellOutput::new_builder()
        .capacity(900_000_000_000u64)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(fund)
                .build(),
        )
        .output(output)
        .output_data(Bytes::from(bad_data).pack())
        .witness(Bytes::new().pack())
        .build();
    let tx = context.complete_tx(tx);
    assert!(
        context.verify_tx(&tx, MAX_CYCLES).is_err(),
        "mint with 31-byte data must fail"
    );
}

#[test]
fn crash_spend_reveal_passes() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_scripts(&mut context);

    let preimage = [42u8; 32];
    let commitment = Bytes::from(blake2b256(&preimage).to_vec());

    let committed = CellOutput::new_builder()
        .capacity(900_000_000_000u64)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(committed, commitment);

    let change = CellOutput::new_builder()
        .capacity(890_000_000_000u64)
        .lock(lock_script.clone())
        .build();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_op)
                .build(),
        )
        .output(change)
        .output_data(Bytes::new().pack())
        .witness(Bytes::from(preimage.to_vec()).pack())
        .build();
    let tx = context.complete_tx(tx);
    verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES).expect("spend should pass");
}

#[test]
fn crash_spend_wrong_preimage_fails() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_scripts(&mut context);

    let real_preimage = [1u8; 32];
    let commitment = Bytes::from(blake2b256(&real_preimage).to_vec());

    let committed = CellOutput::new_builder()
        .capacity(900_000_000_000u64)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(committed, commitment);

    let wrong_witness = [2u8; 32];

    let change = CellOutput::new_builder()
        .capacity(890_000_000_000u64)
        .lock(lock_script.clone())
        .build();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_op)
                .build(),
        )
        .output(change)
        .output_data(Bytes::new().pack())
        .witness(Bytes::from(wrong_witness.to_vec()).pack())
        .build();
    let tx = context.complete_tx(tx);
    assert!(
        context.verify_tx(&tx, MAX_CYCLES).is_err(),
        "wrong preimage must fail"
    );
}

// --- crash-seed-commit-sha256 (SHA-256 of UTF-8 server_seed, matches @cellbet/shared) ---

fn sha256_raw_utf8(s: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    h.finalize().into()
}

fn deploy_sha256_scripts(
    context: &mut Context,
) -> (
    ckb_testtool::ckb_types::packed::Script,
    ckb_testtool::ckb_types::packed::Script,
) {
    let crash_op = context.deploy_cell_by_name("crash-seed-commit-sha256");
    let always_op = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let type_script = context
        .build_script_with_hash_type(&crash_op, ScriptHashType::Data1, Bytes::default())
        .expect("type script");
    let lock_script = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::default())
        .expect("lock script");
    (type_script, lock_script)
}

#[test]
fn crash_sha256_mint_valid_commitment_passes() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_sha256_scripts(&mut context);

    let fund = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000_000_000u64)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );

    // Same shape as backend `randomServerSeed()`: 64-char hex string.
    let server_seed = "aabbccdd".repeat(8);
    let commitment = sha256_raw_utf8(&server_seed);

    let output = CellOutput::new_builder()
        .capacity(900_000_000_000u64)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(fund)
                .build(),
        )
        .output(output)
        .output_data(Bytes::from(commitment.to_vec()).pack())
        .witness(Bytes::new().pack())
        .build();
    let tx = context.complete_tx(tx);
    verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES).expect("mint should pass");
}

#[test]
fn crash_sha256_spend_reveal_passes() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_sha256_scripts(&mut context);

    let server_seed = "0123456789abcdef".repeat(4);
    let commitment = Bytes::from(sha256_raw_utf8(&server_seed).to_vec());

    let committed = CellOutput::new_builder()
        .capacity(900_000_000_000u64)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(committed, commitment);

    let change = CellOutput::new_builder()
        .capacity(890_000_000_000u64)
        .lock(lock_script.clone())
        .build();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_op)
                .build(),
        )
        .output(change)
        .output_data(Bytes::new().pack())
        .witness(Bytes::from(server_seed.as_bytes().to_vec()).pack())
        .build();
    let tx = context.complete_tx(tx);
    verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES).expect("spend should pass");
}

#[test]
fn crash_sha256_spend_wrong_seed_fails() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_sha256_scripts(&mut context);

    let real_seed = "deadbeef".repeat(8);
    let commitment = Bytes::from(sha256_raw_utf8(&real_seed).to_vec());

    let committed = CellOutput::new_builder()
        .capacity(900_000_000_000u64)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(committed, commitment);

    let change = CellOutput::new_builder()
        .capacity(890_000_000_000u64)
        .lock(lock_script.clone())
        .build();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_op)
                .build(),
        )
        .output(change)
        .output_data(Bytes::new().pack())
        .witness(Bytes::from("wrong-seed-not-64-hex-chars________________________".as_bytes().to_vec()).pack())
        .build();
    let tx = context.complete_tx(tx);
    assert!(
        context.verify_tx(&tx, MAX_CYCLES).is_err(),
        "wrong UTF-8 seed must fail"
    );
}
