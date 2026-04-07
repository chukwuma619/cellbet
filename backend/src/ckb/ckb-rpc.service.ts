import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CkbRpcService {
  private readonly log = new Logger(CkbRpcService.name);

  constructor(private readonly config: ConfigService) {}

  get rpcUrl(): string | undefined {
    const u = this.config.get<string>('CKB_RPC_URL')?.trim();
    return u || undefined;
  }

  private async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const url = this.rpcUrl;
    if (!url) {
      throw new Error('CKB_RPC_URL is not set');
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    });
    if (!res.ok) {
      throw new Error(`CKB RPC HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      result?: T;
      error?: { message?: string; code?: number };
    };
    if (body.error) {
      throw new Error(body.error.message ?? 'CKB RPC error');
    }
    return body.result as T;
  }

  async getTipBlockNumber(): Promise<string | null> {
    if (!this.rpcUrl) return null;
    try {
      const hex = await this.rpc<string>('get_tip_block_number', []);
      return BigInt(hex).toString();
    } catch (e) {
      this.log.warn(`get_tip_block_number failed: ${String(e)}`);
      return null;
    }
  }

  async getTransaction(txHash: string): Promise<unknown | null> {
    if (!this.rpcUrl) return null;
    try {
      const h = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
      return await this.rpc('get_transaction', [h]);
    } catch (e) {
      this.log.warn(`get_transaction failed: ${String(e)}`);
      return null;
    }
  }
}
