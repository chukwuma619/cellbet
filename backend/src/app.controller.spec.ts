import { Test, TestingModule } from '@nestjs/testing';
import type { NeonDrizzle } from '@cellbet/shared/db';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DRIZZLE } from './database/database.tokens';

const mockDb = {
  execute: jest.fn().mockResolvedValue(undefined),
} as unknown as NeonDrizzle;

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: DRIZZLE, useValue: mockDb }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});
