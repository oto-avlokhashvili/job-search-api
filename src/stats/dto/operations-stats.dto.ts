import { ApiProperty } from '@nestjs/swagger';

export class AggregatorItemDto {
  @ApiProperty({ example: 'jobs-ge' })
  id: string;

  @ApiProperty({ example: 'Jobs.ge' })
  name: string;

  @ApiProperty({ example: true })
  active: boolean;

  @ApiProperty({ example: 'https://jobs.ge/favicon.ico', required: false })
  iconUrl?: string;
}

export class PortalCountsDto {
  @ApiProperty({ example: 3120 })
  jobsGe: number;

  @ApiProperty({ example: 2480 })
  hrGe: number;

  @ApiProperty({ example: 640 })
  aworkGe: number;

  @ApiProperty({ example: 1890 })
  myjobsGe: number;

  @ApiProperty({ example: 1280 })
  linkedin: number;
}

export class OperationsStatsDto {
  @ApiProperty({
    description: 'Number of active Pro users (აქტიური აგენტები)',
    example: 14204,
  })
  activeAgents: number;

  @ApiProperty({
    description: 'Total number of registered users (აქტიური მომხმარებლები)',
    example: 8942,
  })
  activeUsers: number;

  @ApiProperty({
    description: 'Number of active scrapers/aggregators (აქტიური აგრეგატორები)',
    example: 4,
  })
  activeAggregators: number;

  @ApiProperty({
    description: 'Total number of active vacancies (აქტიური ვაკანსიები)',
    example: 8551,
  })
  activeVacancies: number;

  @ApiProperty({
    description: 'Total amount of uploaded CVs (შესაბამისობის სიზუსტე / რეზიუმეები)',
    example: 94,
  })
  uploadedCvs: number;

  @ApiProperty({
    description: 'Overall system status indicator (სისტემის სტატუსი)',
    example: 'ოპტიმალური',
  })
  systemStatus: string;

  @ApiProperty({
    description: 'Number of synced portals (სინქრონიზებული პორტალები)',
    example: 4,
  })
  syncedPortals: number;

  @ApiProperty({
    description: 'Average calculation/processing time in seconds (გათვლის საშუალო დრო)',
    example: 1.2,
  })
  avgCalculationTimeSeconds: number;

  @ApiProperty({
    description: 'List of active aggregator scrapers',
    type: [AggregatorItemDto],
  })
  aggregators: AggregatorItemDto[];

  @ApiProperty({
    description: 'Number of jobs per source portal',
    type: PortalCountsDto,
  })
  portalCounts: PortalCountsDto;
}
