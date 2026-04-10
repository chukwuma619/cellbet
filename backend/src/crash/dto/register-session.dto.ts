import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class RegisterSessionDto {
  @IsString()
  @IsNotEmpty()
  walletAddress!: string;

  @IsString()
  @IsNotEmpty()
  txHash!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  outputIndex!: number;
}
