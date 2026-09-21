import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StatsService } from './stats.service';
import { OperationsStatsDto } from './dto/operations-stats.dto';

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  @ApiOperation({ summary: 'Get operational and dashboard statistics' })
  @ApiResponse({
    status: 200,
    description: 'Operations statistics containing active agents, users, aggregators, vacancies, and uploaded CVs',
    type: OperationsStatsDto,
  })
  async getStats(): Promise<OperationsStatsDto> {
    return await this.statsService.getOperationsStats();
  }
}
