import { Controller, Get, Param } from '@nestjs/common';

import { CkbRpcService } from './ckb-rpc.service';

@Controller('ckb')
export class CkbController {
  constructor(private readonly ckb: CkbRpcService) {}

  @Get('tip')
  async tip() {
    const blockNumber = await this.ckb.getTipBlockNumber();
    return {
      configured: Boolean(this.ckb.rpcUrl),
      tipBlockNumber: blockNumber,
    };
  }

  @Get('tx/:hash')
  async tx(@Param('hash') hash: string) {
    const raw = await this.ckb.getTransaction(hash);
    return { configured: Boolean(this.ckb.rpcUrl), found: raw != null, raw };
  }
}
