import { Module } from '@nestjs/common';

import { CkbController } from './ckb.controller';
import { CkbRpcService } from './ckb-rpc.service';

@Module({
  controllers: [CkbController],
  providers: [CkbRpcService],
  exports: [CkbRpcService],
})
export class CkbModule {}
