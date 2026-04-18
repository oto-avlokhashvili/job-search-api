import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Req } from '@nestjs/common';
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
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('bearerAuth')
@Get()
findOne(
  @Req() req,
  @Query('page') page = '1',
  @Query('limit') limit = '10',
) {
  return this.sentJobsService.findByUserId(req.user.id, Number(page), Number(limit));
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
