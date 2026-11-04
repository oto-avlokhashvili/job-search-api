import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { FavoritesService } from './favorites.service';
import { MergeFavoritesDto } from './dto/merge-favorites.dto';

@ApiTags('Favorites')
@ApiBearerAuth('bearerAuth')
@UseGuards(JwtAuthGuard)
@Controller('favorites')
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  @ApiOperation({ summary: 'Saved vacancies of the current user, newest first' })
  findAll(@Req() req) {
    return this.favoritesService.findAll(req.user.id);
  }

  @Get('ids')
  @ApiOperation({ summary: 'Ids of the saved vacancies (for the favorite buttons)' })
  findIds(@Req() req) {
    return this.favoritesService.findIds(req.user.id);
  }

  @Post('merge')
  @HttpCode(200)
  @ApiOperation({ summary: 'Import vacancies saved in the browser before signing in' })
  merge(@Req() req, @Body() dto: MergeFavoritesDto) {
    return this.favoritesService.merge(req.user.id, dto.jobIds);
  }

  @Put(':jobId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Save a vacancy (idempotent)' })
  add(@Req() req, @Param('jobId', ParseIntPipe) jobId: number) {
    return this.favoritesService.add(req.user.id, jobId);
  }

  @Delete(':jobId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a saved vacancy (idempotent)' })
  remove(@Req() req, @Param('jobId', ParseIntPipe) jobId: number) {
    return this.favoritesService.remove(req.user.id, jobId);
  }
}
