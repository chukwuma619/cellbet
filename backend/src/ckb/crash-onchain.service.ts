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
} from '@ckb-ccc/core';
import {
  CKB_MIN_OCCUPIED_CAPACITY_SHANNONS,
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

export type CrashEscrowRef = {
  txHash: `0x${string}`;
  outputIndex: number;
};

function normalizeTxHash(h: string): `0x${string}` {
  const t = h.trim();
  return (t.startsWith('0x') ? t : `0x${t}`) as `0x${string}`;
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

  /**
   * House publishes commitment cell (round id + sha256(server seed utf8)).
   * Output index is always 0 for this tx shape.
   */
  async anchorCommitForRound(params: {
    chainRoundId: bigint;
    serverSeedUtf8: string;
  }): Promise<CrashEscrowRef> {
    const signer = this.houseSignerOrNull();
    if (!signer) {
      throw new Error('HOUSE_CKB_PRIVATE_KEY is not configured');
    }
    const client = this.ckbRpc.getCccClient();
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

    tx.addOutput(
      {
        capacity: CKB_MIN_OCCUPIED_CAPACITY_SHANNONS,
        lock: houseAddr.script,
        type: typeScript,
      },
      hexFrom(data),
    );

    await tx.completeInputsByCapacity(signer);
    await tx.completeFeeBy(signer);
    const txHash = await signer.sendTransaction(tx);
    return { txHash, outputIndex: 0 };
  }

  /** Spend commitment cell to reveal server seed (proves hash preimage on-chain). */
  async revealCommitForRound(params: {
    commit: CrashEscrowRef;
    chainRoundId: bigint;
    serverSeedUtf8: string;
  }): Promise<`0x${string}`> {
    const signer = this.houseSignerOrNull();
    if (!signer) {
      throw new Error('HOUSE_CKB_PRIVATE_KEY is not configured');
    }
    const client = this.ckbRpc.getCccClient();
    const houseAddr = await signer.getRecommendedAddressObj();

    const cellInput = CellInput.from({
      previousOutput: {
        txHash: params.commit.txHash,
        index: params.commit.outputIndex,
      },
    });
    await cellInput.completeExtraInfos(client);
    const cell = await cellInput.getCell(client);
    const cap = BigInt(cell.cellOutput.capacity.toString());

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
      params.chainRoundId,
      params.serverSeedUtf8,
    );
    tx.setWitnessArgsAt(
      0,
      WitnessArgs.from({
        inputType: hexFrom(witnessBytes),
      }),
    );

    await tx.prepareSighashAllWitness(houseAddr.script, 85, client);
    const signed = await signer.signOnlyTransaction(tx);
    return signer.sendTransaction(signed);
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
    await tx.completeFeeChangeToOutput(signer, 2);

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

    await tx.prepareSighashAllWitness(houseAddr.script, 85, client);
    const signed = await signer.signOnlyTransaction(tx);
    return signer.sendTransaction(signed);
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

    tx.setWitnessArgsAt(
      0,
      WitnessArgs.from({
        inputType: hexFrom(forfeitBytes),
      }),
    );

    await tx.prepareSighashAllWitness(houseAddr.script, 85, client);
    const signed = await signer.signOnlyTransaction(tx);
    return signer.sendTransaction(signed);
  }
}

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}
