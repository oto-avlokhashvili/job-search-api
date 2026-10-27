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

@ApiTags('HR')
@ApiBearerAuth('bearerAuth')
@Controller('hr')
@UseGuards(JwtAuthGuard, RolesGuard, ClientIpThrottlerGuard)
@Roles(UserRole.HR, UserRole.ADMIN)
export class HrController {
  constructor(
    private readonly hrCandidatesService: HrCandidatesService,
    private readonly hrPipelineService: HrPipelineService,
  ) {}

  @Patch('candidates/:cvId/pipeline')
  @ApiOperation({ summary: 'Move an unlocked candidate on your board, or set its rating/tags' })
  updatePipeline(@Req() req, @Param('cvId', ParseIntPipe) cvId: number, @Body() dto: UpdatePipelineDto) {
    return this.hrPipelineService.update(req.user, cvId, dto);
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

  @Get('candidates/unlocked')
  @ApiOperation({ summary: 'Candidates whose contacts you have opened' })
  listUnlocked(@Req() req) {
    return this.hrCandidatesService.listUnlocked(req.user);
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
