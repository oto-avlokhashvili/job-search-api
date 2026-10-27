import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PipelineStage } from 'src/Entities/hr-pipeline-entry.entity';
import { MAX_TAGS } from '../pipeline';

// Every field is optional; send only what changed. null clears rating / rejection reason.
export class UpdatePipelineDto {
  @ApiPropertyOptional({ enum: PipelineStage })
  @IsOptional()
  @IsEnum(PipelineStage)
  stage?: PipelineStage;

  @ApiPropertyOptional({ description: 'Kept only when the stage is REJECTED', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  rejectionReason?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number | null;

  @ApiPropertyOptional({ type: [String], maxItems: MAX_TAGS })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];

  @ApiPropertyOptional({
    type: [Number],
    description: "CV ids of the candidate's new column, top to bottom, after a drag-and-drop",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  order?: number[];
}

export class CreateNoteDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;
}
