import { IsOptional, IsString } from 'class-validator';

export class CashOutDto {
  @IsString()
  walletAddress!: string;

  /** When set, cashes out that specific open bet (e.g. second stake in the same round). */
  @IsOptional()
  @IsString()
  betId?: string;
}
