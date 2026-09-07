import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, Equals } from 'class-validator';

export class CreateCvDto {
  @ApiProperty({
    example: true,
    description: 'Consent to store and process this CV. Must be true.',
  })
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  @Equals(true, { message: 'Consent is required to upload your CV' })
  consent: boolean;
}
