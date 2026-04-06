import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createNeonDrizzle } from '@cellbet/shared/db';

import { DRIZZLE } from './database.tokens';

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('DATABASE_URL');
        if (!url) {
          throw new Error(
            'DATABASE_URL is not set. Add it to backend/.env (Neon Postgres connection string).',
          );
        }
        return createNeonDrizzle(url);
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}
