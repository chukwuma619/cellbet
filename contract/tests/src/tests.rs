//! Integration tests for the unified `crash-round` type script. Build the RISC-V binary first:
//! `npm run build:scripts` from `contract/` (copies artifacts to `contract/build/release/`).

use ckb_testtool::builtin::ALWAYS_SUCCESS;
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::{ScriptHashType, TransactionBuilder},
    packed::{CellInput, CellOutput},
    prelude::*,
};
use ckb_testtool::context::Context;
use sha2::{Digest, Sha256};

use crate::verify_and_dump_failed_tx;

const MAX_CYCLES: u64 = 70_000_000;

fn sha256_raw_utf8(s: &str) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    h.finalize().into()
}

fn deploy_crash_round(
    context: &mut Context,
) -> (
    ckb_testtool::ckb_types::packed::Script,
    ckb_testtool::ckb_types::packed::Script,
) {
    let op = context.deploy_cell_by_name("crash-round");
    let always_op = context.deploy_cell(ALWAYS_SUCCESS.clone());
    let type_script = context
        .build_script_with_hash_type(&op, ScriptHashType::Data1, Bytes::default())
        .expect("type script");
    let lock_script = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::default())
        .expect("lock script");
    (type_script, lock_script)
}

fn encode_commit_v1(round_id: u64, server_seed_hash: &[u8; 32]) -> [u8; 42] {
    let mut d = [0u8; 42];
    d[0] = 1;
    d[1] = 0;
    d[2..10].copy_from_slice(&round_id.to_le_bytes());
    d[10..42].copy_from_slice(server_seed_hash);
    d
}

fn encode_escrow_v2(
    round_id: u64,
    server_seed_hash: &[u8; 32],
    user_lock: &ckb_testtool::ckb_types::packed::Script,
    house_lock: &ckb_testtool::ckb_types::packed::Script,
    platform_lock: &ckb_testtool::ckb_types::packed::Script,
    stake: u64,
    fee_bps: u16,
) -> [u8; 148] {
    let mut d = [0u8; 148];
    d[0] = 1;
    d[1] = 1;
    d[2..10].copy_from_slice(&round_id.to_le_bytes());
    d[10..42].copy_from_slice(server_seed_hash);
    let uh = user_lock.calc_script_hash();
    let hh = house_lock.calc_script_hash();
    let ph = platform_lock.calc_script_hash();
    d[42..74].copy_from_slice(uh.as_slice());
    d[74..106].copy_from_slice(hh.as_slice());
    d[106..114].copy_from_slice(&stake.to_le_bytes());
    d[114..146].copy_from_slice(ph.as_slice());
    d[146..148].copy_from_slice(&fee_bps.to_le_bytes());
    d
}

/// Win settlement witness: tag `1` + payouts + output indices (28 bytes).
fn encode_win_witness_v2(
    user_payout: u64,
    platform_payout: u64,
    house_payout: u64,
    user_idx: u8,
    platform_idx: u8,
    house_idx: u8,
) -> [u8; 28] {
    let mut w = [0u8; 28];
    w[0] = 1;
    w[1..9].copy_from_slice(&user_payout.to_le_bytes());
    w[9..17].copy_from_slice(&platform_payout.to_le_bytes());
    w[17..25].copy_from_slice(&house_payout.to_le_bytes());
    w[25] = user_idx;
    w[26] = platform_idx;
    w[27] = house_idx;
    w
}

#[test]
fn crash_round_mint_commit_passes() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_crash_round(&mut context);

    let fund = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000_000_000u64)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );

    let round_id: u64 = 4242;
    let server_seed = "aabbccdd".repeat(8);
    let h = sha256_raw_utf8(&server_seed);
    let data = encode_commit_v1(round_id, &h);

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
        .output_data(Bytes::from(data.to_vec()).pack())
        .witness(Bytes::new().pack())
        .build();
    let tx = context.complete_tx(tx);
    verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES).expect("mint commit should pass");
}

#[test]
fn crash_round_mint_commit_wrong_length_fails() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_crash_round(&mut context);

    let fund = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000_000_000u64)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );

    let bad = vec![1u8, 0u8]; // too short

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
        .output_data(Bytes::from(bad).pack())
        .witness(Bytes::new().pack())
        .build();
    let tx = context.complete_tx(tx);
    assert!(
        context.verify_tx(&tx, MAX_CYCLES).is_err(),
        "mint commit with wrong length must fail"
    );
}

#[test]
fn crash_round_spend_commit_reveal_passes() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_crash_round(&mut context);

    let round_id: u64 = 99;
    let server_seed = "0123456789abcdef".repeat(4);
    let h = sha256_raw_utf8(&server_seed);
    let data = encode_commit_v1(round_id, &h);

    let committed = CellOutput::new_builder()
        .capacity(900_000_000_000u64)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(committed, Bytes::from(data.to_vec()));

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
    verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES).expect("reveal should pass");
}

#[test]
fn crash_round_spend_commit_wrong_round_fails() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_crash_round(&mut context);

    let round_id: u64 = 1;
    let server_seed = "deadbeef".repeat(8);
    let h = sha256_raw_utf8(&server_seed);
    let data = encode_commit_v1(round_id, &h);

    let committed = CellOutput::new_builder()
        .capacity(900_000_000_000u64)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(committed, Bytes::from(data.to_vec()));

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

#[test]
fn crash_round_mint_escrow_passes() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_crash_round(&mut context);
    let always_op = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let user_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x01u8]))
        .expect("user lock");
    let house_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x02u8]))
        .expect("house lock");
    let platform_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x09u8]))
        .expect("platform lock");

    let fund = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000_000_000u64)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );

    let round_id: u64 = 7;
    let seed_hash = sha256_raw_utf8("seed");
    let stake: u64 = 900_000_000_000;
    let data = encode_escrow_v2(
        round_id,
        &seed_hash,
        &user_lock,
        &house_lock,
        &platform_lock,
        stake,
        300,
    );

    let output = CellOutput::new_builder()
        .capacity(stake)
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
        .output_data(Bytes::from(data.to_vec()).pack())
        .witness(Bytes::new().pack())
        .build();
    let tx = context.complete_tx(tx);
    verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES).expect("mint escrow should pass");
}

#[test]
fn crash_round_mint_escrow_capacity_mismatch_fails() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_crash_round(&mut context);
    let always_op = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let user_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x03u8]))
        .expect("user lock");
    let house_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x04u8]))
        .expect("house lock");
    let platform_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x0au8]))
        .expect("platform lock");

    let fund = context.create_cell(
        CellOutput::new_builder()
            .capacity(1_000_000_000_000u64)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );

    let stake: u64 = 900_000_000_000;
    let data = encode_escrow_v2(
        1,
        &sha256_raw_utf8("x"),
        &user_lock,
        &house_lock,
        &platform_lock,
        stake,
        300,
    );

    let output = CellOutput::new_builder()
        .capacity(stake - 1)
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
        .output_data(Bytes::from(data.to_vec()).pack())
        .witness(Bytes::new().pack())
        .build();
    let tx = context.complete_tx(tx);
    assert!(
        context.verify_tx(&tx, MAX_CYCLES).is_err(),
        "capacity != stake must fail"
    );
}

#[test]
fn crash_round_settlement_win_with_fee_passes() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_crash_round(&mut context);
    let always_op = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let user_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x05u8]))
        .expect("user lock");
    let house_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x06u8]))
        .expect("house lock");
    let platform_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x0bu8]))
        .expect("platform lock");

    let round_id: u64 = 7;
    let seed_hash = sha256_raw_utf8("seed");
    let total: u64 = 900_000_000_000;
    let data = encode_escrow_v2(
        round_id,
        &seed_hash,
        &user_lock,
        &house_lock,
        &platform_lock,
        total,
        300,
    );

    let escrow = CellOutput::new_builder()
        .capacity(total)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(escrow, Bytes::from(data.to_vec()));

    // cap 900e9; house 100e9; g = user+platform = 800e9; fee 3% => platform 24e9, user 776e9
    let house_payout: u64 = 100_000_000_000;
    let platform_payout: u64 = 24_000_000_000;
    let user_payout: u64 = 776_000_000_000;

    let out_user = CellOutput::new_builder()
        .capacity(user_payout)
        .lock(user_lock.clone())
        .build();
    let out_platform = CellOutput::new_builder()
        .capacity(platform_payout)
        .lock(platform_lock.clone())
        .build();
    let out_house = CellOutput::new_builder()
        .capacity(house_payout)
        .lock(house_lock.clone())
        .build();

    let w = encode_win_witness_v2(user_payout, platform_payout, house_payout, 0, 1, 2);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_op)
                .build(),
        )
        .output(out_user)
        .output(out_platform)
        .output(out_house)
        .output_data(Bytes::new().pack())
        .output_data(Bytes::new().pack())
        .output_data(Bytes::new().pack())
        .witness(Bytes::from(w.to_vec()).pack())
        .build();
    let tx = context.complete_tx(tx);
    verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES).expect("settlement should pass");
}

#[test]
fn crash_round_settlement_win_wrong_fee_split_fails() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_crash_round(&mut context);
    let always_op = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let user_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x07u8]))
        .expect("user lock");
    let house_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x08u8]))
        .expect("house lock");
    let platform_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x0cu8]))
        .expect("platform lock");

    let total: u64 = 900_000_000_000;
    let data = encode_escrow_v2(
        1,
        &sha256_raw_utf8("y"),
        &user_lock,
        &house_lock,
        &platform_lock,
        total,
        300,
    );

    let escrow = CellOutput::new_builder()
        .capacity(total)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(escrow, Bytes::from(data.to_vec()));

    // Sum ok but fee split wrong: g=450e9 => platform must be 13.5e9, not 50e9
    let user_payout: u64 = 400_000_000_000;
    let platform_payout: u64 = 50_000_000_000;
    let house_payout: u64 = 450_000_000_000;
    let w = encode_win_witness_v2(user_payout, platform_payout, house_payout, 0, 1, 2);

    let out_user = CellOutput::new_builder()
        .capacity(user_payout)
        .lock(user_lock.clone())
        .build();
    let out_platform = CellOutput::new_builder()
        .capacity(platform_payout)
        .lock(platform_lock.clone())
        .build();
    let out_house = CellOutput::new_builder()
        .capacity(house_payout)
        .lock(house_lock.clone())
        .build();

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_op)
                .build(),
        )
        .output(out_user)
        .output(out_platform)
        .output(out_house)
        .output_data(Bytes::new().pack())
        .output_data(Bytes::new().pack())
        .output_data(Bytes::new().pack())
        .witness(Bytes::from(w.to_vec()).pack())
        .build();
    let tx = context.complete_tx(tx);
    assert!(
        context.verify_tx(&tx, MAX_CYCLES).is_err(),
        "wrong fee split must fail"
    );
}

#[test]
fn crash_round_forfeit_loss_passes() {
    let mut context = Context::default();
    let (type_script, lock_script) = deploy_crash_round(&mut context);
    let always_op = context.deploy_cell(ALWAYS_SUCCESS.clone());

    let user_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x0du8]))
        .expect("user lock");
    let house_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x0eu8]))
        .expect("house lock");
    let platform_lock = context
        .build_script_with_hash_type(&always_op, ScriptHashType::Data1, Bytes::from(vec![0x0fu8]))
        .expect("platform lock");

    let total: u64 = 500_000_000_000;
    let data = encode_escrow_v2(
        42,
        &sha256_raw_utf8("loss"),
        &user_lock,
        &house_lock,
        &platform_lock,
        total,
        300,
    );

    let escrow = CellOutput::new_builder()
        .capacity(total)
        .lock(lock_script.clone())
        .type_(Some(type_script).pack())
        .build();
    let input_op = context.create_cell(escrow, Bytes::from(data.to_vec()));

    let out_house = CellOutput::new_builder()
        .capacity(total)
        .lock(house_lock.clone())
        .build();

    let witness = Bytes::from(vec![0u8, 0u8]);

    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_op)
                .build(),
        )
        .output(out_house)
        .output_data(Bytes::new().pack())
        .witness(witness.pack())
        .build();
    let tx = context.complete_tx(tx);
    verify_and_dump_failed_tx(&context, &tx, MAX_CYCLES).expect("forfeit should pass");
}
