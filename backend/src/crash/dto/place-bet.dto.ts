import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PlaceBetDto {
  @IsString()
  walletAddress!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.00000001)
  @Max(1_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  clientSeed?: string;

  /** Transaction hash from `buildPlaceBetTx` (escrow output). */
  @IsString()
  @IsNotEmpty()
  escrowTxHash!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  escrowOutputIndex?: number;
}
