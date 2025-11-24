import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { JobService } from './job.service';
import { UpdateJobDto } from './dto/update-job.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { FilterJobDto } from './dto/filter-job.dto';
import { ApiQuery } from '@nestjs/swagger';

@Controller('job')
export class JobController {
  constructor(private readonly jobService: JobService) {}

  @Post('create')
  async create(@Body() createJobDto: CreateJobDto) {
    return await this.jobService.create(createJobDto);
  }
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'vacancy', required: false, type: String })
  @Get('all')
  async findAll(@Query() filterDto: FilterJobDto) {
    return await this.jobService.findAll(filterDto);
  }
  @Get('search')
  async searchJobs(@Query('query') query: string) {
    return this.jobService.findAllByQuery(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return await this.jobService.findOne(+id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateJobDto: UpdateJobDto) {
    return await this.jobService.update(+id, updateJobDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.jobService.remove(+id);
  }
}
