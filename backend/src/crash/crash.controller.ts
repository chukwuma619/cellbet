import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from "@nestjs/common";

import { CashOutDto } from "./dto/cash-out.dto";
import { PlaceBetDto } from "./dto/place-bet.dto";
import { CrashService } from "./crash.service";

@Controller("crash")
export class CrashController {
  constructor(private readonly crashService: CrashService) {}

  @Get("state")
  getState() {
    return this.crashService.getPublicSnapshotAsync();
  }

  @Get("balance")
  getBalance(@Query("walletAddress") walletAddress: string | undefined) {
    if (!walletAddress?.trim()) {
      throw new BadRequestException("walletAddress is required");
    }
    return this.crashService.getCkbBalance(walletAddress.trim());
  }

  @Get("rounds/:roundId/proof")
  getRoundProof(@Param("roundId") roundId: string) {
    return this.crashService.getRoundProof(roundId);
  }

  @Get("history/rounds")
  getRoundHistory(@Query("limit") limit?: string) {
    const n = limit != null ? Number.parseInt(limit, 10) : 20;
    return this.crashService.getRecentSettledRounds(
      Number.isFinite(n) ? n : 20,
    );
  }

  @Get("history/bets")
  getBetHistory(
    @Query("walletAddress") walletAddress: string | undefined,
    @Query("limit") limit?: string,
  ) {
    if (!walletAddress?.trim()) {
      throw new BadRequestException("walletAddress is required");
    }
    const n = limit != null ? Number.parseInt(limit, 10) : 50;
    return this.crashService.getRecentBetsForWallet(
      walletAddress.trim(),
      Number.isFinite(n) ? n : 50,
    );
  }

  @Post("bets")
  async placeBet(@Body() body: PlaceBetDto) {
    try {
      return await this.crashService.placeBet(
        body.walletAddress,
        body.amount,
        body.clientSeed,
      );
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : "Could not place bet",
      );
    }
  }

  @Post("cashout")
  async cashOut(@Body() body: CashOutDto) {
    try {
      return await this.crashService.cashOut(body.walletAddress);
    } catch (e) {
      throw new BadRequestException(
        e instanceof Error ? e.message : "Could not cash out",
      );
    }
  }
}
