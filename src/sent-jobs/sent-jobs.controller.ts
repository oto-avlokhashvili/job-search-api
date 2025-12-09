import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { SentJobsService } from './sent-jobs.service';
import { CreateSentJobDto } from './dto/create-sent-job.dto';
import { UpdateSentJobDto } from './dto/update-sent-job.dto';

@Controller('sent-jobs')
export class SentJobsController {
  constructor(private readonly sentJobsService: SentJobsService) {}

  @Post()
  create(@Body() createSentJobDto: CreateSentJobDto) {
    return this.sentJobsService.create(createSentJobDto);
  }

  @Get()
  findAll() {
    return this.sentJobsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sentJobsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSentJobDto: UpdateSentJobDto) {
    return this.sentJobsService.update(+id, updateSentJobDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sentJobsService.remove(+id);
  }
}
