import { Module } from '@nestjs/common';

import { CrashSettlementService } from './crash-settlement.service';
import { CkbController } from './ckb.controller';
import { CkbRpcService } from './ckb-rpc.service';

@Module({
  controllers: [CkbController],
  providers: [CkbRpcService, CrashSettlementService],
  exports: [CkbRpcService, CrashSettlementService],
})
export class CkbModule {}
