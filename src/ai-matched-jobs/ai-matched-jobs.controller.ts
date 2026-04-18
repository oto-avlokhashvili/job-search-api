import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Query,
  DefaultValuePipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiParam, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AiMatchedJobsService } from './ai-matched-jobs.service';
import { CreateAiMatchedJobDto } from './dto/create-ai-matched-job.dto';
import { UpdateAiMatchedJobDto } from './dto/update-ai-matched-job.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@ApiTags('AI Matched Jobs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('bearerAuth')
@Controller('ai-matched-jobs')
export class AiMatchedJobsController {
  constructor(private readonly aiMatchedJobsService: AiMatchedJobsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a single AI matched job for a user' })
  create(
    @Req() req,
    @Body() createAiMatchedJobDto: CreateAiMatchedJobDto,
  ) {
    return this.aiMatchedJobsService.create(req.user.id, createAiMatchedJobDto);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Bulk insert AI matched jobs for a user, skipping duplicates' })
  createBulk(
    @Req() req,
    @Body() createAiMatchedJobDtos: CreateAiMatchedJobDto[],
  ) {
    return this.aiMatchedJobsService.createBulk(req.user.id, createAiMatchedJobDtos);
  }

  @Get()
  @ApiOperation({ summary: 'Get all AI matched jobs for a user (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  findAll(
    @Req() req,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.aiMatchedJobsService.findAll(req.user.id, page, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single AI matched job by ID' })
  @ApiParam({ name: 'id', type: Number })
  findOne(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.aiMatchedJobsService.findOne(req.user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an AI matched job' })
  @ApiParam({ name: 'id', type: Number })
  update(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateAiMatchedJobDto: UpdateAiMatchedJobDto,
  ) {
    return this.aiMatchedJobsService.update(req.user.id, id, updateAiMatchedJobDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an AI matched job' })
  @ApiParam({ name: 'id', type: Number })
  @ApiResponse({ status: 204, description: 'Deleted successfully' })
  remove(
    @Req() req,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.aiMatchedJobsService.remove(req.user.id, id);
  }
}