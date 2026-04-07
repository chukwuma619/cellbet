import {
  Address,
  CellDep,
  CellInput,
  KnownScript,
  Transaction,
  WitnessArgs,
  SignerCkbPrivateKey,
  hexFrom,
} from '@ckb-ccc/core';
import {
  decodeCrashEscrowCellDataV2,
  encodeCrashForfeitWitnessV1,
  encodeCrashWinWitnessV2,
  grossCashoutShannons,
  hex32ToBytes,
  userNetFromGrossShannons,
} from '@cellbet/shared';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CkbRpcService } from './ckb-rpc.service';

const MIN_CELL_SHANNONS = 61_00000000n;
const FEE_BUFFER_SHANNONS = 2_000000n;

export type CrashSettlementEscrowRef = {
  txHash: `0x${string}`;
  outputIndex: number;
};

@Injectable()
export class CrashSettlementService {
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

  async settleWinOnChain(params: {
    escrow: CrashSettlementEscrowRef;
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
      throw new Error('userCkbAddress does not match escrow cell user lock hash');
    }
    if (!buffersEqual(platformHash, escrowData.platformLockHash)) {
      throw new Error('platform address does not match escrow cell');
    }
    if (!buffersEqual(houseHash, escrowData.houseLockHash)) {
      throw new Error('house signer does not match escrow cell house lock hash');
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
    tx.addOutput({ lock: platformAddress.script, capacity: platformShannons }, '0x');
    tx.addOutput({ lock: houseAddr.script, capacity: MIN_CELL_SHANNONS }, '0x');

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
    escrow: CrashSettlementEscrowRef;
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
