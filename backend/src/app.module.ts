import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CrashModule } from './crash/crash.module';
import { CkbModule } from './ckb/ckb.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    CrashModule,
    CkbModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
