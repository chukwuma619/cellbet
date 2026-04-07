import { Controller, Get, Param } from '@nestjs/common';

import { CkbRpcService } from './ckb-rpc.service';

@Controller('ckb')
export class CkbController {
  constructor(private readonly ckb: CkbRpcService) {}

  /** Tip block number when `CKB_RPC_URL` is configured (indexer / node sync sanity). */
  @Get('tip')
  async tip() {
    const blockNumber = await this.ckb.getTipBlockNumber();
    return {
      configured: Boolean(this.ckb.rpcUrl),
      tipBlockNumber: blockNumber,
    };
  }

  /** Best-effort tx lookup (same RPC your wallets use). */
  @Get('tx/:hash')
  async tx(@Param('hash') hash: string) {
    const raw = await this.ckb.getTransaction(hash);
    return { configured: Boolean(this.ckb.rpcUrl), found: raw != null, raw };
  }
}
