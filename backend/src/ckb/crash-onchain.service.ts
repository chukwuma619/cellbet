import {
  Address,
  CellDep,
  CellInput,
  KnownScript,
  Script,
  SignerCkbPrivateKey,
  Transaction,
  WitnessArgs,
  hexFrom,
  type Client,
} from '@ckb-ccc/core';
import {
  CKB_MIN_OCCUPIED_CAPACITY_SHANNONS,
  decodeCrashCommitCellDataV1,
  encodeCrashCommitCellDataV1,
  hex32ToBytes,
  sha256BytesUtf8,
} from '@cellbet/shared';
import {
  decodeCrashEscrowCellDataV2,
  encodeCrashForfeitWitnessV1,
  encodeCrashWinWitnessV2,
  encodeRoundAnchorRevealWitness,
} from './crash-cell-data';
import {
  grossCashoutShannons,
  userNetFromGrossShannons,
} from '../crash/settlement-math';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CkbRpcService } from './ckb-rpc.service';

const FEE_BUFFER_SHANNONS = 2_000000n;

const POOL_FEE_RATE_NUM = 180n;
const POOL_FEE_RATE_DEN = 100n;
const ANCHOR_POOL_FEE_RATE_NUM = 200n;
const ANCHOR_POOL_FEE_RATE_DEN = 100n;

const RBF_SHANNONS_PER_1000_BYTES = 2500n;
const RBF_ANCHOR_FLAT_PADDING_SHANNONS = 25_000n;
const RBF_RETRY_EXTRA_SHANNONS = 50_000n;
const MAX_RBF_SEND_ATTEMPTS = 12;

export type CrashEscrowRef = {
  txHash: `0x${string}`;
  outputIndex: number;
};

function normalizeTxHash(h: string): `0x${string}` {
  const t = h.trim();
  return (t.startsWith('0x') ? t : `0x${t}`) as `0x${string}`;
}

function parsePoolRejectedRbf(err: unknown): {
  current: bigint;
  required: bigint;
} | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes('PoolRejectedRBF')) return null;
  const cur = msg.match(/current fee is (\d+)/);
  const req = msg.match(/expect it to >= (\d+)/);
  if (!cur?.[1] || !req?.[1]) return null;
  return { current: BigInt(cur[1]), required: BigInt(req[1]) };
}

function hexOutputDataToBytes(od: string): Uint8Array {
  const s = od.trim();
  const hex = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
  if (hex.length % 2 === 1) {
    throw new Error('Invalid output data hex length');
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

@Injectable()
export class CrashOnchainService {
  constructor(
    private readonly config: ConfigService,
    private readonly ckbRpc: CkbRpcService,
  ) {}

  private houseSignerOrNull(): SignerCkbPrivateKey | null {
    const pk = this.config.get<string>('HOUSE_CKB_PRIVATE_KEY')?.trim();
    if (!pk) {
      return null;
    }
    return new SignerCkbPrivateKey(this.ckbRpc.getCccClient(), pk);
  }

  private crashTypeScript(): Script {
    const codeHash = this.config
      .get<string>('CRASH_ROUND_TYPE_SCRIPT_CODE_HASH')
      ?.trim();
    const hashType = (
      this.config.get<string>('CRASH_ROUND_TYPE_SCRIPT_HASH_TYPE') ?? 'data1'
    ).trim();
    if (!codeHash) {
      throw new Error('CRASH_ROUND_TYPE_SCRIPT_CODE_HASH is not set');
    }
    return Script.from({
      codeHash: codeHash as `0x${string}`,
      hashType: hashType as 'data1' | 'data2' | 'type',
      args: '0x',
    });
  }

  private async crashCellDeps(
    client: ReturnType<CkbRpcService['getCccClient']>,
  ) {
    const txHash = this.config
      .get<string>('CRASH_ROUND_SCRIPT_CELL_DEP_TX_HASH')
      ?.trim();
    const indexRaw = this.config.get<string>(
      'CRASH_ROUND_SCRIPT_CELL_DEP_INDEX',
    );
    if (!txHash || indexRaw === undefined || indexRaw === '') {
      throw new Error(
        'CRASH_ROUND_SCRIPT_CELL_DEP_TX_HASH / CRASH_ROUND_SCRIPT_CELL_DEP_INDEX are not set',
      );
    }
    const index = Number.parseInt(indexRaw, 10);
    const depType = (
      this.config.get<string>('CRASH_ROUND_SCRIPT_CELL_DEP_TYPE') ?? 'code'
    ).trim();
    const crashDep = CellDep.from({
      outPoint: { txHash: txHash as `0x${string}`, index },
      depType: depType as 'code' | 'depGroup',
    });
    const secpInfo = await client.getKnownScript(KnownScript.Secp256k1Blake160);
    const secpDeps = await client.getCellDeps(...secpInfo.cellDeps);
    return [crashDep, ...secpDeps];
  }

  private async clearCccClientCellAndTxCache(client: Client): Promise<void> {
    const cache = client.cache as { clear?: () => void | Promise<void> };
    if (typeof cache.clear === 'function') {
      await cache.clear();
    }
  }

  private async poolFeeRate(
    client: ReturnType<CkbRpcService['getCccClient']>,
    kind: 'default' | 'anchor' = 'default',
  ): Promise<bigint> {
    const base = await client.getFeeRate();
    const br = typeof base === 'bigint' ? base : BigInt(String(base));
    if (kind === 'anchor') {
      return (
        (br * ANCHOR_POOL_FEE_RATE_NUM + ANCHOR_POOL_FEE_RATE_DEN - 1n) /
        ANCHOR_POOL_FEE_RATE_DEN
      );
    }
    return (
      (br * POOL_FEE_RATE_NUM + POOL_FEE_RATE_DEN - 1n) / POOL_FEE_RATE_DEN
    );
  }

  private shrinkHouseChangeForExtraFee(
    tx: Transaction,
    houseLock: Script,
    extraFeeShannons: bigint,
  ): void {
    if (extraFeeShannons <= 0n) return;
    for (let i = tx.outputs.length - 1; i >= 0; i--) {
      const out = tx.outputs[i];
      if (out.type) continue;
      if (!out.lock.eq(houseLock)) continue;
      const cap = BigInt(out.capacity.toString());
      const next = cap - extraFeeShannons;
      if (next < CKB_MIN_OCCUPIED_CAPACITY_SHANNONS) continue;
      out.capacity = next;
      return;
    }
    throw new Error(
      'Could not add CKB fee headroom: no house change output with spare capacity',
    );
  }

  private async applyAnchorInitialRbfHeadroom(
    tx: Transaction,
    signer: SignerCkbPrivateKey,
    houseLock: Script,
  ): Promise<void> {
    const preview = await signer.prepareTransaction(tx);
    const sz = BigInt(preview.toBytes().length + 4);
    const fromSize = (RBF_SHANNONS_PER_1000_BYTES * sz + 999n) / 1000n;
    this.shrinkHouseChangeForExtraFee(
      tx,
      houseLock,
      fromSize + RBF_ANCHOR_FLAT_PADDING_SHANNONS,
    );
  }

  private async submitHouseTx(
    client: Client,
    signer: SignerCkbPrivateKey,
    tx: Transaction,
  ): Promise<`0x${string}`> {
    const { script: houseLock } = await signer.getRecommendedAddressObj();

    for (let attempt = 0; attempt < MAX_RBF_SEND_ATTEMPTS; attempt++) {
      try {
        const prepared = await signer.prepareTransaction(tx);
        const signed = await signer.signOnlyTransaction(prepared);
        return await client.sendTransaction(signed);
      } catch (e) {
        const rbf = parsePoolRejectedRbf(e);
        if (!rbf || attempt === MAX_RBF_SEND_ATTEMPTS - 1) {
          throw e;
        }
        const bump = rbf.required - rbf.current + RBF_RETRY_EXTRA_SHANNONS;
        this.shrinkHouseChangeForExtraFee(tx, houseLock, bump);
      }
    }
    throw new Error('submitHouseTx: exhausted RBF retries');
  }

  async anchorCommitForRound(params: {
    chainRoundId: bigint;
    serverSeedUtf8: string;
  }): Promise<CrashEscrowRef> {
    const signer = this.houseSignerOrNull();
    if (!signer) {
      throw new Error('HOUSE_CKB_PRIVATE_KEY is not configured');
    }
    const client = this.ckbRpc.getCccClient();
    await this.clearCccClientCellAndTxCache(client);
    const commitment = sha256BytesUtf8(params.serverSeedUtf8);
    const data = encodeCrashCommitCellDataV1(params.chainRoundId, commitment);
    const typeScript = this.crashTypeScript();
    const houseAddr = await signer.getRecommendedAddressObj();

    const tx = Transaction.from({
      version: 0,
      cellDeps: await this.crashCellDeps(client),
      headerDeps: [],
      inputs: [],
      outputs: [],
      outputsData: [],
      witnesses: [],
    });

    tx.addOutput({ lock: houseAddr.script, type: typeScript }, hexFrom(data));

    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer, await this.poolFeeRate(client, 'anchor'));
    await this.applyAnchorInitialRbfHeadroom(tx, signer, houseAddr.script);
    const txHash = await this.submitHouseTx(client, signer, tx);
    return { txHash, outputIndex: 0 };
  }

  async revealCommitForRound(params: {
    commit: CrashEscrowRef;
    serverSeedUtf8: string;
  }): Promise<`0x${string}`> {
    const signer = this.houseSignerOrNull();
    if (!signer) {
      throw new Error('HOUSE_CKB_PRIVATE_KEY is not configured');
    }
    const client = this.ckbRpc.getCccClient();
    const houseAddr = await signer.getRecommendedAddressObj();

    const outPoint = {
      txHash: normalizeTxHash(params.commit.txHash),
      index: Number(params.commit.outputIndex),
    };

    const cellInput = CellInput.from({
      previousOutput: outPoint,
    });
    await cellInput.completeExtraInfos(client);

    let sourceCell =
      (await client.getCellLive(outPoint, true, true)) ??
      (await client.getCellLiveNoCache(outPoint, true, true));
    if (!sourceCell) {
      await this.clearCccClientCellAndTxCache(client);
      sourceCell = await client.getCellLiveNoCache(outPoint, true, true);
    }
    if (!sourceCell) {
      throw new Error(
        `Commit cell not found or not live yet (confirm commit tx, output index, or wait for indexer). out_point=${outPoint.txHash}:${String(outPoint.index)}`,
      );
    }

    const cap = BigInt(sourceCell.cellOutput.capacity.toString());
    const od = sourceCell.outputData;
    if (!od || od === '0x') {
      throw new Error('Commit cell has no type data');
    }
    const commitBytes = hexOutputDataToBytes(od);
    const { roundId: commitRoundId } = decodeCrashCommitCellDataV1(commitBytes);

    const tx = Transaction.from({
      version: 0,
      cellDeps: await this.crashCellDeps(client),
      headerDeps: [],
      inputs: [],
      outputs: [],
      outputsData: [],
      witnesses: [],
    });

    tx.addInput(cellInput);
    tx.addOutput({ lock: houseAddr.script, capacity: cap }, '0x');

    const witnessBytes = encodeRoundAnchorRevealWitness(
      commitRoundId,
      params.serverSeedUtf8,
    );
    const witnessPlaceholder = new Uint8Array(witnessBytes.length);
    tx.setWitnessArgsAt(
      0,
      WitnessArgs.from({
        inputType: hexFrom(witnessPlaceholder),
      }),
    );

    await tx.completeFeeChangeToOutput(
      signer,
      0,
      await this.poolFeeRate(client),
      undefined,
      { shouldAddInputs: false },
    );

    const afterFee = tx.getWitnessArgsAt(0) ?? WitnessArgs.from({});
    tx.setWitnessArgsAt(
      0,
      WitnessArgs.from({
        lock: afterFee.lock,
        inputType: hexFrom(witnessBytes),
        outputType: afterFee.outputType,
      }),
    );

    return this.submitHouseTx(client, signer, tx);
  }

  async verifyUserEscrowCell(params: {
    escrowTxHash: string;
    escrowOutputIndex: number;
    userCkbAddress: string;
    chainRoundId: bigint;
    serverSeedHashHex: string;
    stakeShannons: bigint;
    feeBps: number;
  }): Promise<void> {
    const client = this.ckbRpc.getCccClient();
    const txHash = normalizeTxHash(params.escrowTxHash);
    const cell = await client.getCellLive(
      { txHash, index: params.escrowOutputIndex },
      true,
      true,
    );
    if (!cell) {
      throw new Error(
        'Escrow cell not found (confirm the transaction and try again)',
      );
    }

    const expectedType = this.crashTypeScript();
    const actualType = cell.cellOutput.type;
    if (!actualType || !Script.from(expectedType).eq(actualType)) {
      throw new Error('Escrow cell type script does not match deployment');
    }

    const od = cell.outputData;
    if (!od || od === '0x') {
      throw new Error('Escrow cell has no type data');
    }
    const dataBytes = Uint8Array.from(Buffer.from(od.slice(2), 'hex'));
    const escrowData = decodeCrashEscrowCellDataV2(dataBytes);

    if (escrowData.roundId !== params.chainRoundId) {
      throw new Error('Escrow round id does not match current round');
    }

    const wantHash = hex32ToBytes(params.serverSeedHashHex);
    if (!buffersEqual(wantHash, escrowData.serverSeedHashSha256)) {
      throw new Error('Escrow server seed hash mismatch');
    }

    if (escrowData.stakeShannons !== params.stakeShannons) {
      throw new Error('Escrow stake does not match bet amount');
    }

    if (escrowData.feeBps !== params.feeBps) {
      throw new Error('Escrow fee_bps does not match server configuration');
    }

    const cap = BigInt(cell.cellOutput.capacity.toString());
    if (cap !== escrowData.stakeShannons) {
      throw new Error('Escrow cell capacity must equal stake');
    }

    const userAddr = await Address.fromString(params.userCkbAddress, client);
    const userHash = hex32ToBytes(userAddr.script.hash());
    if (!buffersEqual(userHash, escrowData.userLockHash)) {
      throw new Error('Escrow user lock does not match wallet address');
    }

    const signer = this.houseSignerOrNull();
    if (!signer) {
      throw new Error(
        'HOUSE_CKB_PRIVATE_KEY is required to validate house/platform locks on escrow cells',
      );
    }
    const platformStr =
      this.config.get<string>('PLATFORM_CKB_ADDRESS')?.trim() ??
      this.config.get<string>('NEXT_PUBLIC_PLATFORM_CKB_ADDRESS')?.trim();
    if (!platformStr) {
      throw new Error('PLATFORM_CKB_ADDRESS is not set');
    }
    const houseAddr = await signer.getRecommendedAddressObj();
    const platformAddr = await Address.fromString(platformStr, client);
    const expectedHouseHash = hex32ToBytes(Script.from(houseAddr.script).hash());
    const expectedPlatformHash = hex32ToBytes(
      Script.from(platformAddr.script).hash(),
    );
    if (!buffersEqual(expectedHouseHash, escrowData.houseLockHash)) {
      throw new Error(
        'Escrow house lock hash does not match configured house wallet',
      );
    }
    if (!buffersEqual(expectedPlatformHash, escrowData.platformLockHash)) {
      throw new Error(
        'Escrow platform lock hash does not match PLATFORM_CKB_ADDRESS',
      );
    }
  }

  async settleWinOnChain(params: {
    escrow: CrashEscrowRef;
    userCkbAddress: string;
    multiplier: number;
  }): Promise<`0x${string}`> {
    const signer = this.houseSignerOrNull();
    if (!signer) {
      throw new Error('HOUSE_CKB_PRIVATE_KEY is not configured');
    }

    const client = this.ckbRpc.getCccClient();
    const platformAddr =
      this.config.get<string>('PLATFORM_CKB_ADDRESS')?.trim() ??
      this.config.get<string>('NEXT_PUBLIC_PLATFORM_CKB_ADDRESS')?.trim();
    if (!platformAddr) {
      throw new Error('PLATFORM_CKB_ADDRESS is not set');
    }

    const cellInput = CellInput.from({
      previousOutput: {
        txHash: params.escrow.txHash,
        index: params.escrow.outputIndex,
      },
    });
    await cellInput.completeExtraInfos(client);
    const cell = await cellInput.getCell(client);
    const od = cell.outputData;
    if (!od || od === '0x') {
      throw new Error('escrow cell has no type data');
    }
    const dataBytes = Uint8Array.from(Buffer.from(od.slice(2), 'hex'));
    const escrowData = decodeCrashEscrowCellDataV2(dataBytes);

    const userAddr = await Address.fromString(params.userCkbAddress, client);
    const platformAddress = await Address.fromString(platformAddr, client);
    const houseAddr = await signer.getRecommendedAddressObj();

    const userHash = hex32ToBytes(userAddr.script.hash());
    const platformHash = hex32ToBytes(platformAddress.script.hash());
    const houseHash = hex32ToBytes(houseAddr.script.hash());

    if (!buffersEqual(userHash, escrowData.userLockHash)) {
      throw new Error(
        'userCkbAddress does not match escrow cell user lock hash',
      );
    }
    if (!buffersEqual(platformHash, escrowData.platformLockHash)) {
      throw new Error('platform address does not match escrow cell');
    }
    if (!buffersEqual(houseHash, escrowData.houseLockHash)) {
      throw new Error(
        'house signer does not match escrow cell house lock hash',
      );
    }

    const stake = escrowData.stakeShannons;
    const gross = grossCashoutShannons(stake, params.multiplier);
    const { platformShannons, userShannons } = userNetFromGrossShannons(
      gross,
      escrowData.feeBps,
    );

    const tx = Transaction.from({
      version: 0,
      cellDeps: await this.crashCellDeps(client),
      headerDeps: [],
      inputs: [],
      outputs: [],
      outputsData: [],
      witnesses: [],
    });

    tx.addInput(cellInput);
    tx.addOutput({ lock: userAddr.script, capacity: userShannons }, '0x');
    tx.addOutput(
      { lock: platformAddress.script, capacity: platformShannons },
      '0x',
    );
    tx.addOutput(
      {
        lock: houseAddr.script,
        capacity: CKB_MIN_OCCUPIED_CAPACITY_SHANNONS,
      },
      '0x',
    );

    await tx.completeInputsByCapacity(signer, FEE_BUFFER_SHANNONS);
    await tx.completeFeeChangeToOutput(
      signer,
      2,
      await this.poolFeeRate(client),
    );

    const houseOut = tx.getOutput(2);
    if (!houseOut) {
      throw new Error('missing house output after fee completion');
    }
    const housePayout = BigInt(houseOut.cellOutput.capacity.toString());

    const winBytes = encodeCrashWinWitnessV2({
      userPayoutShannons: userShannons,
      platformPayoutShannons: platformShannons,
      housePayoutShannons: housePayout,
      userOutputIndex: 0,
      platformOutputIndex: 1,
      houseOutputIndex: 2,
    });

    tx.setWitnessArgsAt(
      0,
      WitnessArgs.from({
        inputType: hexFrom(winBytes),
      }),
    );

    return this.submitHouseTx(client, signer, tx);
  }

  async settleForfeitOnChain(params: {
    escrow: CrashEscrowRef;
  }): Promise<`0x${string}`> {
    const signer = this.houseSignerOrNull();
    if (!signer) {
      throw new Error('HOUSE_CKB_PRIVATE_KEY is not configured');
    }

    const client = this.ckbRpc.getCccClient();
    const cellInput = CellInput.from({
      previousOutput: {
        txHash: params.escrow.txHash,
        index: params.escrow.outputIndex,
      },
    });
    await cellInput.completeExtraInfos(client);

    const cap = BigInt(
      (await cellInput.getCell(client)).cellOutput.capacity.toString(),
    );

    const tx = Transaction.from({
      version: 0,
      cellDeps: await this.crashCellDeps(client),
      headerDeps: [],
      inputs: [],
      outputs: [],
      outputsData: [],
      witnesses: [],
    });

    tx.addInput(cellInput);
    const houseAddr = await signer.getRecommendedAddressObj();
    tx.addOutput({ lock: houseAddr.script, capacity: cap }, '0x');

    const forfeitBytes = encodeCrashForfeitWitnessV1(0);
    const forfeitPlaceholder = new Uint8Array(forfeitBytes.length);
    tx.setWitnessArgsAt(
      0,
      WitnessArgs.from({
        inputType: hexFrom(forfeitPlaceholder),
      }),
    );

    await tx.completeFeeChangeToOutput(
      signer,
      0,
      await this.poolFeeRate(client),
      undefined,
      { shouldAddInputs: false },
    );

    const afterForfeitFee = tx.getWitnessArgsAt(0) ?? WitnessArgs.from({});
    tx.setWitnessArgsAt(
      0,
      WitnessArgs.from({
        lock: afterForfeitFee.lock,
        inputType: hexFrom(forfeitBytes),
        outputType: afterForfeitFee.outputType,
      }),
    );

    return this.submitHouseTx(client, signer, tx);
  }
}

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}
