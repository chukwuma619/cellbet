import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class ConfirmDepositDto {
  @IsString()
  @IsNotEmpty()
  walletAddress!: string;

  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  outputIndex?: number;
}
