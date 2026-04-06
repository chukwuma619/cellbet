import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class PlaceBetDto {
  @IsString()
  walletAddress!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.00000001)
  @Max(1_000_000)
  amount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1.01)
  @Max(1000)
  autoCashoutMultiplier?: number;
}
