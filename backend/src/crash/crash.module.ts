import { Module } from '@nestjs/common';

import { CkbModule } from '../ckb/ckb.module';
import { CrashDepositService } from './crash-deposit.service';
import { CrashController } from './crash.controller';
import { CrashGateway } from './crash.gateway';
import { CrashService } from './crash.service';

@Module({
  imports: [CkbModule],
  controllers: [CrashController],
  providers: [CrashService, CrashDepositService, CrashGateway],
  exports: [CrashService],
})
export class CrashModule {}
