import { Inject, Injectable } from '@nestjs/common';
import { pingDatabase, type NeonDrizzle } from './db';

import { DRIZZLE } from './database/database.tokens';

@Injectable()
export class AppService {
  constructor(@Inject(DRIZZLE) private readonly db: NeonDrizzle) {}

  getHello(): string {
    return 'Hello World!';
  }

  async checkDatabase(): Promise<{ ok: true }> {
    await pingDatabase(this.db);
    return { ok: true };
  }
}
