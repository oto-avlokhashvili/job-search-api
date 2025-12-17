import { Controller, Get, Post, Body, Patch, Param, Delete, Query, ParseIntPipe, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JobService } from './job.service';
import { CreateJobDto } from './dto/create-job.dto';
import { UpdateJobDto } from './dto/update-job.dto';
import { FilterJobDto } from './dto/filter-job.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@Controller('job')
export class JobController {
  constructor(private readonly jobService: JobService) {}
  
  @Post('scrapper')
  async insertMany(): Promise<boolean> {
    await this.jobService.scrapper();
    return true;
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Post('create')
  async create(@Body() createJobDto: CreateJobDto) {
    return await this.jobService.create(createJobDto);
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'vacancy', required: false, type: String })
  @Get('all')
  async findAll(@Query() filterDto: FilterJobDto) {
    return await this.jobService.findAll(filterDto);
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Get('search')
  async searchJobs(@Query('query') query: string) {
    return this.jobService.findAllByQuery(query);
  }

  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Get('check-duplicates')
  async checkDuplicates() {
    const duplicates = await this.jobService.findDuplicates();
    return {
      totalDuplicates: duplicates.length,
      duplicates,
    };
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return await this.jobService.findOne(id);
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() updateJobDto: UpdateJobDto) {
    return await this.jobService.update(id, updateJobDto);
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.jobService.remove(id);
  }
  @ApiBearerAuth('bearerAuth')  
  @UseGuards(JwtAuthGuard)
  @Delete()
  async hardDelete() {
    return this.jobService.hardRemove();
  }
}
