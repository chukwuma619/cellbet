//! Integration tests for Cellbet type scripts. Build all RISC-V binaries first:
//! `npm run build:scripts` from `contract/` (copies artifacts to `contract/build/release/`).

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

fn deploy_round_anchor_scripts(
    context: &mut Context,
) -> (
    ckb_testtool::ckb_types::packed::Script,
    ckb_testtool::ckb_types::packed::Script,
) {
    let op = context.deploy_cell_by_name("crash-round-anchor");
    let always_op = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let type_script = context
        .build_script_with_hash_type(&op, ScriptHashType::Data1, Bytes::default())
        .expect("type script");
    let lock_script = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::default())
        .expect("lock script");
    (type_script, lock_script)
}

#[test]
fn crash_round_anchor_mint_passes() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_round_anchor_scripts(&mut context);

    let fund = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000_000_000u64)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );

    let round_id: u64 = 4242;
    let server_seed = "aabbccdd".repeat(8);
    let mut data40 = [0u8; 40];
    data40[0..8].copy_from_slice(&round_id.to_le_bytes());
    data40[8..40].copy_from_slice(&sha256_raw_utf8(&server_seed));

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
        .output_data(Bytes::from(data40.to_vec()).pack())
        .witness(Bytes::new().pack())
        .build();
    let tx = context.complete_tx(tx);
    verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES).expect("anchor mint should pass");
}

#[test]
fn crash_round_anchor_spend_reveal_passes() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_round_anchor_scripts(&mut context);

    let round_id: u64 = 99;
    let server_seed = "0123456789abcdef".repeat(4);
    let mut data40 = [0u8; 40];
    data40[0..8].copy_from_slice(&round_id.to_le_bytes());
    data40[8..40].copy_from_slice(&sha256_raw_utf8(&server_seed));

    let committed = CellOutput::new_builder()
        .capacity(900_000_000_000u64)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(committed, Bytes::from(data40.to_vec()));

    let change = CellOutput::new_builder()
        .capacity(890_000_000_000u64)
        .lock(lock_script.clone())
        .build();

    let mut witness = Vec::with_capacity(8 + server_seed.len());
    witness.extend_from_slice(&round_id.to_le_bytes());
    witness.extend_from_slice(server_seed.as_bytes());

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_op)
                .build(),
        )
        .output(change)
        .output_data(Bytes::new().pack())
        .witness(Bytes::from(witness).pack())
        .build();
    let tx = context.complete_tx(tx);
    verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES).expect("anchor reveal should pass");
}

#[test]
fn crash_round_anchor_wrong_round_in_witness_fails() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_round_anchor_scripts(&mut context);

    let round_id: u64 = 1;
    let server_seed = "deadbeef".repeat(8);
    let mut data40 = [0u8; 40];
    data40[0..8].copy_from_slice(&round_id.to_le_bytes());
    data40[8..40].copy_from_slice(&sha256_raw_utf8(&server_seed));

    let committed = CellOutput::new_builder()
        .capacity(900_000_000_000u64)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(committed, Bytes::from(data40.to_vec()));

    let change = CellOutput::new_builder()
        .capacity(890_000_000_000u64)
        .lock(lock_script.clone())
        .build();

    let bad_round: u64 = 2;
    let mut witness = Vec::with_capacity(8 + server_seed.len());
    witness.extend_from_slice(&bad_round.to_le_bytes());
    witness.extend_from_slice(server_seed.as_bytes());

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_op)
                .build(),
        )
        .output(change)
        .output_data(Bytes::new().pack())
        .witness(Bytes::from(witness).pack())
        .build();
    let tx = context.complete_tx(tx);
    assert!(
        context.verify_tx(&tx, MAX_CYCLES).is_err(),
        "wrong round_id in witness must fail"
    );
}

fn encode_settlement_data_v1(
    round_id: u64,
    user_lock: &ckb_testtool::ckb_types::packed::Script,
    house_lock: &ckb_testtool::ckb_types::packed::Script,
) -> [u8; 80] {
    let mut d = [0u8; 80];
    d[0..8].copy_from_slice(&round_id.to_le_bytes());
    let uh = user_lock.calc_script_hash();
    let hh = house_lock.calc_script_hash();
    d[8..40].copy_from_slice(uh.as_slice());
    d[40..72].copy_from_slice(hh.as_slice());
    d
}

fn deploy_settlement_scripts(
    context: &mut Context,
) -> (
    ckb_testtool::ckb_types::packed::Script,
    ckb_testtool::ckb_types::packed::Script,
) {
    let op = context.deploy_cell_by_name("crash-settlement-split");
    let always_op = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let type_script = context
        .build_script_with_hash_type(&op, ScriptHashType::Data1, Bytes::default())
        .expect("type script");
    let lock_script = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::default())
        .expect("lock script");
    (type_script, lock_script)
}

#[test]
fn crash_settlement_split_passes() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_settlement_scripts(&mut context);
    let always_op = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let user_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x01u8]))
        .expect("user lock");
    let house_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x02u8]))
        .expect("house lock");

    let data80 = encode_settlement_data_v1(7, &user_lock, &house_lock);
    let total: u64 = 900_000_000_000;
    let user_payout: u64 = 400_000_000_000;
    let house_payout: u64 = 500_000_000_000;

    let escrow = CellOutput::new_builder()
        .capacity(total)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(escrow, Bytes::from(data80.to_vec()));

    let out_user = CellOutput::new_builder()
        .capacity(user_payout)
        .lock(user_lock.clone())
        .build();
    let out_house = CellOutput::new_builder()
        .capacity(house_payout)
        .lock(house_lock.clone())
        .build();

    let mut w = [0u8; 18];
    w[0..8].copy_from_slice(&user_payout.to_le_bytes());
    w[8..16].copy_from_slice(&house_payout.to_le_bytes());
    w[16] = 0;
    w[17] = 1;

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_op)
                .build(),
        )
        .output(out_user)
        .output(out_house)
        .output_data(Bytes::new().pack())
        .output_data(Bytes::new().pack())
        .witness(Bytes::from(w.to_vec()).pack())
        .build();
    let tx = context.complete_tx(tx);
    verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES).expect("settlement should pass");
}

#[test]
fn crash_settlement_split_bad_sum_fails() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_settlement_scripts(&mut context);
    let always_op = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let user_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x03u8]))
        .expect("user lock");
    let house_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x04u8]))
        .expect("house lock");

    let data80 = encode_settlement_data_v1(1, &user_lock, &house_lock);
    let total: u64 = 900_000_000_000;

    let escrow = CellOutput::new_builder()
        .capacity(total)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(escrow, Bytes::from(data80.to_vec()));

    let out_user = CellOutput::new_builder()
        .capacity(400_000_000_000)
        .lock(user_lock.clone())
        .build();
    let out_house = CellOutput::new_builder()
        .capacity(400_000_000_000)
        .lock(house_lock.clone())
        .build();

    let mut w = [0u8; 18];
    w[0..8].copy_from_slice(&400_000_000_000u64.to_le_bytes());
    w[8..16].copy_from_slice(&400_000_000_000u64.to_le_bytes());
    w[16] = 0;
    w[17] = 1;

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_op)
                .build(),
        )
        .output(out_user)
        .output(out_house)
        .output_data(Bytes::new().pack())
        .output_data(Bytes::new().pack())
        .witness(Bytes::from(w.to_vec()).pack())
        .build();
    let tx = context.complete_tx(tx);
    assert!(
        context.verify_tx(&tx, MAX_CYCLES).is_err(),
        "payouts not summing to capacity must fail"
    );
}
