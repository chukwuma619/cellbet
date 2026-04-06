import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
} from "@nestjs/common";

import { CashOutDto } from "./dto/cash-out.dto";
import { PlaceBetDto } from "./dto/place-bet.dto";
import { CrashService } from "./crash.service";

@Controller("crash")
export class CrashController {
  constructor(private readonly crashService: CrashService) {}

  @Get("state")
  getState() {
    return this.crashService.getPublicSnapshot();
  }

  @Post("bets")
  async placeBet(@Body() body: PlaceBetDto) {
    try {
      return await this.crashService.placeBet(
        body.walletAddress,
        body.amount,
        body.autoCashoutMultiplier,
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
