import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseIntPipe, BadRequestException } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { JobService } from './job.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { FilterJobDto } from './dto/filter-job.dto';

@Controller('job')
export class JobController {
  constructor(private readonly jobService: JobService) {}

  @Post('scrapper')
  async insertMany(): Promise<boolean> {
    await this.jobService.scrapper();
    return true;
  }

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


  @Get('check-duplicates')
  async checkDuplicates() {
    const duplicates = await this.jobService.findDuplicates();
    return {
      totalDuplicates: duplicates.length,
      duplicates,
    };
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return await this.jobService.findOne(id);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateJobDto: UpdateJobDto) {
    return await this.jobService.update(id, updateJobDto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.jobService.remove(id);
  }

  @Delete()
  async hardDelete() {
    return this.jobService.hardRemove();
  }
}
