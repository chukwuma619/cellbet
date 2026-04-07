import { Module } from '@nestjs/common';

import { CrashOnchainService } from './crash-onchain.service';
import { CkbController } from './ckb.controller';
import { CkbRpcService } from './ckb-rpc.service';

@Module({
  controllers: [CkbController],
  providers: [CkbRpcService, CrashOnchainService],
  exports: [CkbRpcService, CrashOnchainService],
})
export class CkbModule {}
