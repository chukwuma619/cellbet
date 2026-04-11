import { IsNotEmpty, IsString } from 'class-validator';

export class CloseSessionDto {
  @IsString()
  @IsNotEmpty()
  walletAddress!: string;
}
