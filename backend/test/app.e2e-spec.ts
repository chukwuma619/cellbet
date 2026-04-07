import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import type { NeonDrizzle } from '../src/db';

import { AppModule } from './../src/app.module';
import { CrashService } from './../src/crash/crash.service';
import { DRIZZLE } from './../src/database/database.tokens';

const mockDb = {
  execute: jest.fn().mockResolvedValue(undefined),
} as unknown as NeonDrizzle;

const crashServiceStub = {
  onModuleInit: () => undefined,
  onModuleDestroy: () => undefined,
  getPublicSnapshot: () => ({ round: null, participants: [] }),
  getPublicSnapshotAsync: () =>
    Promise.resolve({ round: null, participants: [] }),
};

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DRIZZLE)
      .useValue(mockDb)
      .overrideProvider(CrashService)
      .useValue(crashServiceStub)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
