import { Module } from "@nestjs/common";

import { CrashController } from "./crash.controller";
import { CrashGateway } from "./crash.gateway";
import { CrashService } from "./crash.service";

@Module({
  controllers: [CrashController],
  providers: [CrashService, CrashGateway],
  exports: [CrashService],
})
export class CrashModule {}
