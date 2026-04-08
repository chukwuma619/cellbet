import {
  Address,
  Script,
  fixedPointToString,
  hexFrom,
  type Client,
} from '@ckb-ccc/core';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, sql } from 'drizzle-orm';

import { crashDepositReceipts, type NeonDrizzle, walletAccounts } from '../db';
import { CkbRpcService } from '../ckb/ckb-rpc.service';
import { DRIZZLE } from '../database/database.tokens';

type RpcTxWithStatus = {
  transaction?: {
    inputs?: Array<{
      previous_output?: { tx_hash?: string; index?: string };
    }>;
    outputs?: Array<{
      capacity?: string;
      lock?: { code_hash?: string; hash_type?: string; args?: string };
    }>;
  };
  tx_status?: { status?: string };
};

function normalizeTxHash(h: string): string {
  const t = h.trim();
  return t.startsWith('0x') ? t : `0x${t}`;
}

function hexToBigInt(h: string | undefined): bigint {
  if (!h?.trim()) return BigInt(0);
  const s = h.trim().startsWith('0x') ? h.trim() : `0x${h.trim()}`;
  return BigInt(s);
}

@Injectable()
export class CrashDepositService {
  private readonly logger = new Logger(CrashDepositService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: NeonDrizzle,
    private readonly config: ConfigService,
    private readonly ckbRpc: CkbRpcService,
  ) {}

  private poolDepositAddress(): string {
    const a =
      this.config.get<string>('CRASH_POOL_DEPOSIT_CKB_ADDRESS')?.trim() ??
      this.config.get<string>('NEXT_PUBLIC_CRASH_POOL_DEPOSIT_CKB_ADDRESS')?.trim();
    if (!a) {
      throw new ServiceUnavailableException(
        'Pool deposits are not configured (set CRASH_POOL_DEPOSIT_CKB_ADDRESS).',
      );
    }
    return a;
  }

  async confirmDeposit(params: {
    walletAddress: string;
    txHash: string;
    outputIndex: number;
  }): Promise<{ creditedCkb: string; alreadyCredited: boolean }> {
    const walletAddress = params.walletAddress.trim();
    const txHash = normalizeTxHash(params.txHash);
    const outputIndex = Math.max(0, Math.floor(params.outputIndex));

    if (!this.ckbRpc.rpcUrl) {
      throw new ServiceUnavailableException('CKB_RPC_URL is not set');
    }

    const client = this.ckbRpc.getCccClient();
    const depositAddrStr = this.poolDepositAddress();

    const [existing] = await this.db
      .select({ amountCkb: crashDepositReceipts.amountCkb })
      .from(crashDepositReceipts)
      .where(
        and(
          eq(crashDepositReceipts.txHash, txHash),
          eq(crashDepositReceipts.outputIndex, outputIndex),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        creditedCkb:
          existing.amountCkb != null ? String(existing.amountCkb) : '0',
        alreadyCredited: true,
      };
    }

    const raw = await this.ckbRpc.getTransaction(txHash);
    if (!raw || typeof raw !== 'object') {
      throw new BadRequestException('Transaction not found on chain');
    }
    const packed = raw as RpcTxWithStatus;
    if (packed.tx_status?.status !== 'committed') {
      throw new BadRequestException('Transaction is not committed yet');
    }

    const outs = packed.transaction?.outputs;
    if (!outs || outputIndex >= outs.length) {
      throw new BadRequestException('Invalid output index for this transaction');
    }
    const out = outs[outputIndex];
    if (!out?.lock) {
      throw new BadRequestException('Output has no lock script');
    }

    const depositAddr = await Address.fromString(depositAddrStr, client);
    const outAddr = await Address.fromScript(
      Script.from({
        codeHash: out.lock.code_hash as `0x${string}`,
        hashType: out.lock.hash_type as 'type' | 'data' | 'data1' | 'data2',
        args: out.lock.args as `0x${string}`,
      }),
      client,
    );
    if (
      hexFrom(depositAddr.script.hash()) !== hexFrom(outAddr.script.hash())
    ) {
      throw new BadRequestException(
        'This output does not pay the configured pool deposit address',
      );
    }

    const capacityShannons = hexToBigInt(out.capacity);
    const amountCkbStr = fixedPointToString(capacityShannons, 8);
    const minStr = this.config.get<string>('CRASH_POOL_MIN_DEPOSIT_CKB')?.trim();
    if (minStr) {
      const minN = Number(minStr);
      if (Number.isFinite(minN) && Number(amountCkbStr) < minN) {
        throw new BadRequestException(
          `Deposit must be at least ${minStr} CKB`,
        );
      }
    }

    const inputs = packed.transaction?.inputs ?? [];
    let userOwnsInput = false;
    for (const inp of inputs) {
      const prev = inp.previous_output;
      if (!prev?.tx_hash || prev.index === undefined) continue;
      const idx = Number.parseInt(String(prev.index), 16);
      if (!Number.isFinite(idx)) continue;
      try {
        if (
          await this.previousOutputMatchesWallet(
            client,
            normalizeTxHash(prev.tx_hash),
            idx,
            walletAddress,
          )
        ) {
          userOwnsInput = true;
          break;
        }
      } catch (e) {
        this.logger.warn(
          `Could not resolve input ${prev.tx_hash}:${prev.index}: ${String(e)}`,
        );
      }
    }
    if (!userOwnsInput) {
      throw new BadRequestException(
        'Could not verify you own inputs of this transaction (send CKB from your connected wallet).',
      );
    }

    await this.db.transaction(async (tx) => {
      await tx
        .insert(walletAccounts)
        .values({
          ckbAddress: walletAddress,
          username: walletAddress,
          ckbBalance: '0',
        })
        .onConflictDoNothing();

      await tx.insert(crashDepositReceipts).values({
        txHash,
        outputIndex,
        ckbAddress: walletAddress,
        amountCkb: amountCkbStr,
      });

      await tx
        .update(walletAccounts)
        .set({
          ckbBalance: sql`(${walletAccounts.ckbBalance}::numeric + ${amountCkbStr}::numeric)::numeric`,
        })
        .where(eq(walletAccounts.ckbAddress, walletAddress));
    });

    return { creditedCkb: amountCkbStr, alreadyCredited: false };
  }

  private async previousOutputMatchesWallet(
    client: Client,
    parentTxHash: string,
    outputIndex: number,
    walletAddress: string,
  ): Promise<boolean> {
    const raw = await this.ckbRpc.getTransaction(parentTxHash);
    if (!raw || typeof raw !== 'object') {
      throw new Error('Parent transaction not found');
    }
    const packed = raw as RpcTxWithStatus;
    const outs = packed.transaction?.outputs;
    if (!outs || outputIndex >= outs.length || !outs[outputIndex]?.lock) {
      throw new Error('Parent output missing');
    }
    const lock = outs[outputIndex].lock!;
    const cellAddr = await Address.fromScript(
      Script.from({
        codeHash: lock.code_hash as `0x${string}`,
        hashType: lock.hash_type as 'type' | 'data' | 'data1' | 'data2',
        args: lock.args as `0x${string}`,
      }),
      client,
    );
    const userAddr = await Address.fromString(walletAddress, client);
    return (
      hexFrom(userAddr.script.hash()) === hexFrom(cellAddr.script.hash())
    );
  }
}
