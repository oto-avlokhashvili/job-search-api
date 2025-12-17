import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { SentJobsService } from './sent-jobs.service';
import { CreateSentJobDto } from './dto/create-sent-job.dto';
import { UpdateSentJobDto } from './dto/update-sent-job.dto';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@Controller('sent-jobs')
export class SentJobsController {
  constructor(private readonly sentJobsService: SentJobsService) {}
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() createSentJobDto: CreateSentJobDto) {
    return this.sentJobsService.create(createSentJobDto);
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.sentJobsService.findAll();
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sentJobsService.findOne(+id);
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSentJobDto: UpdateSentJobDto) {
    return this.sentJobsService.update(+id, updateSentJobDto);
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sentJobsService.remove(+id);
  }
}
