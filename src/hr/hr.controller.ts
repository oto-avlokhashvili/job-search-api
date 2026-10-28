import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { ClientIpThrottlerGuard } from 'src/auth/guards/client-ip-throttler.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'src/enums/user-role.enum';
import { LinkedinSearchDto } from 'src/linkedin-search/dto/linkedin-search.dto';
import { HrCandidatesService } from './hr-candidates.service';
import { HrCandidateSearchDto } from './dto/hr-candidate-search.dto';
import { HrPipelineService } from './hr-pipeline.service';
import { CreateNoteDto, UpdatePipelineDto } from './dto/hr-pipeline.dto';
import { HrVacancyService } from './hr-vacancy.service';
import { BoardQueryDto, CreateVacancyDto, UpdateVacancyDto } from './dto/hr-vacancy.dto';
import { HrInterviewService } from './hr-interview.service';
import { ScheduleInterviewDto, UpdateInterviewDto } from './dto/hr-interview.dto';

@ApiTags('HR')
@ApiBearerAuth('bearerAuth')
@Controller('hr')
@UseGuards(JwtAuthGuard, RolesGuard, ClientIpThrottlerGuard)
@Roles(UserRole.HR, UserRole.ADMIN)
export class HrController {
  constructor(
    private readonly hrCandidatesService: HrCandidatesService,
    private readonly hrPipelineService: HrPipelineService,
    private readonly hrVacancyService: HrVacancyService,
    private readonly hrInterviewService: HrInterviewService,
  ) {}

  @Get('interviews')
  @ApiOperation({ summary: 'Your interviews from the last month on, soonest first' })
  listInterviews(@Req() req) {
    return this.hrInterviewService.list(req.user);
  }

  @Post('board/:entryId/interviews')
  @ApiOperation({ summary: 'Schedule an interview for a card (moves it to INTERVIEW, emails the invitation unless send=false)' })
  scheduleInterview(@Req() req, @Param('entryId', ParseIntPipe) entryId: number, @Body() dto: ScheduleInterviewDto) {
    return this.hrInterviewService.schedule(req.user, entryId, dto);
  }

  @Patch('interviews/:id')
  @ApiOperation({ summary: "Edit or reschedule, accept a candidate's proposed time, or cancel" })
  updateInterview(@Req() req, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateInterviewDto) {
    return this.hrInterviewService.update(req.user, id, dto);
  }

  @Get('vacancies')
  @ApiOperation({ summary: 'Your vacancies with candidate counts per stage, plus the count not in any vacancy' })
  listVacancies(@Req() req) {
    return this.hrVacancyService.list(req.user);
  }

  @Post('vacancies')
  @ApiOperation({ summary: 'Create a vacancy (a separate candidate board)' })
  createVacancy(@Req() req, @Body() dto: CreateVacancyDto) {
    return this.hrVacancyService.create(req.user, dto);
  }

  @Patch('vacancies/:id')
  @ApiOperation({ summary: 'Rename, close or reopen a vacancy' })
  updateVacancy(@Req() req, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateVacancyDto) {
    return this.hrVacancyService.update(req.user, id, dto);
  }

  @Delete('vacancies/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a vacancy; its candidates stay unlocked' })
  deleteVacancy(@Req() req, @Param('id', ParseIntPipe) id: number) {
    return this.hrVacancyService.remove(req.user, id);
  }

  @Post('vacancies/:id/candidates/:cvId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a candidate to a vacancy, opening the contacts if needed (counts toward the quota once per CV)' })
  addToVacancy(@Req() req, @Param('id', ParseIntPipe) id: number, @Param('cvId', ParseIntPipe) cvId: number) {
    return this.hrCandidatesService.addToVacancy(req.user, id, cvId);
  }

  @Get('board')
  @ApiOperation({ summary: 'Board cards: all, one vacancy (?vacancyId=) or not in any vacancy (?vacancyId=none)' })
  board(@Req() req, @Query() query: BoardQueryDto) {
    const filter = query.vacancyId === undefined ? undefined : query.vacancyId === 'none' ? 'none' : Number(query.vacancyId);
    return this.hrCandidatesService.board(req.user, filter);
  }

  @Patch('board/:entryId')
  @ApiOperation({ summary: 'Move a board card, or set its rating/tags' })
  updatePipeline(@Req() req, @Param('entryId', ParseIntPipe) entryId: number, @Body() dto: UpdatePipelineDto) {
    return this.hrPipelineService.update(req.user, entryId, dto);
  }

  @Delete('board/:entryId')
  @ApiOperation({ summary: 'Take a card off its vacancy; returns the card kept without a vacancy, if any' })
  removeFromVacancy(@Req() req, @Param('entryId', ParseIntPipe) entryId: number) {
    return this.hrPipelineService.removeFromVacancy(req.user, entryId);
  }

  @Get('candidates/:cvId/activity')
  @ApiOperation({ summary: 'Notes and board history of an unlocked candidate, newest first' })
  activity(@Req() req, @Param('cvId', ParseIntPipe) cvId: number) {
    return this.hrPipelineService.activity(req.user, cvId);
  }

  @Post('candidates/:cvId/notes')
  @ApiOperation({ summary: 'Add a note to an unlocked candidate' })
  addNote(@Req() req, @Param('cvId', ParseIntPipe) cvId: number, @Body() dto: CreateNoteDto) {
    return this.hrPipelineService.addNote(req.user, cvId, dto.body);
  }

  @Delete('candidates/notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of your notes' })
  deleteNote(@Req() req, @Param('noteId', ParseIntPipe) noteId: number) {
    return this.hrPipelineService.deleteNote(req.user, noteId);
  }

  @Get('candidates/cvs')
  @ApiOperation({ summary: 'Search all CVs (anonymized; contacts after unlock)' })
  searchCvs(@Req() req, @Query() dto: HrCandidateSearchDto) {
    return this.hrCandidatesService.searchCvs(req.user, dto);
  }

  @Get('candidates/linkedin')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // Each uncached call drives a real Google search
  @ApiOperation({ summary: 'Search open-to-work LinkedIn profiles via Google (daily quota per HR)' })
  searchLinkedin(@Req() req, @Query() dto: LinkedinSearchDto) {
    return this.hrCandidatesService.searchLinkedin(req.user, dto);
  }

  @Post('candidates/:cvId/unlock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open a candidate\'s contacts (counts toward the monthly quota once per CV)' })
  unlock(@Req() req, @Param('cvId', ParseIntPipe) cvId: number) {
    return this.hrCandidatesService.unlock(req.user, cvId);
  }

  @Get('candidates/:cvId/download')
  @ApiOperation({ summary: 'Download an unlocked candidate\'s CV file' })
  async download(@Req() req, @Param('cvId', ParseIntPipe) cvId: number, @Res() res: any) {
    const { buffer, mimeType, originalName } = await this.hrCandidatesService.download(req.user, cvId);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('usage')
  @ApiOperation({ summary: 'Your quota usage: CV unlocks this month, LinkedIn searches today' })
  usage(@Req() req) {
    return this.hrCandidatesService.usage(req.user);
  }
}
