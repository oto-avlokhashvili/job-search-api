import { PartialType } from '@nestjs/swagger';
import { CreateSentJobDto } from './create-sent-job.dto';

export class UpdateSentJobDto extends PartialType(CreateSentJobDto) {}
