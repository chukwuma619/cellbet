import { IsString } from 'class-validator';

export class CashOutDto {
  @IsString()
  walletAddress!: string;
}
