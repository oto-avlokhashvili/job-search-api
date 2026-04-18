import { PartialType } from '@nestjs/swagger';
import { CreateAiMatchedJobDto } from './create-ai-matched-job.dto';

export class UpdateAiMatchedJobDto extends PartialType(CreateAiMatchedJobDto) {}
