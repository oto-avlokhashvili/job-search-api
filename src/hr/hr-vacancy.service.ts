import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/Entities/user.entity';
import { HrVacancy, HrVacancyStatus } from 'src/Entities/hr-vacancy.entity';
import { PipelineStage } from 'src/Entities/hr-pipeline-entry.entity';
import { CreateVacancyDto, UpdateVacancyDto } from './dto/hr-vacancy.dto';
import { HrPipelineService } from './hr-pipeline.service';

export const MAX_OPEN_VACANCIES = 30;

export interface VacancyView {
  id: number;
  title: string;
  status: HrVacancyStatus;
  createdAt: Date;
  updatedAt: Date;
  total: number;
  stages: Partial<Record<PipelineStage, number>>;
}

/** An HR's own vacancies; each one has its own board of candidates. */
@Injectable()
export class HrVacancyService {
  constructor(
    @InjectRepository(HrVacancy) private readonly vacancyRepository: Repository<HrVacancy>,
    private readonly pipelineService: HrPipelineService,
  ) {}

  /**
   * Open vacancies first, most recently updated first, with candidate counts per stage.
   * `unassigned` counts the candidates not in any vacancy.
   */
  async list(hr: User): Promise<{ vacancies: VacancyView[]; unassigned: number }> {
    const [vacancies, counts] = await Promise.all([
      // Postgres sorts enums in declaration order: OPEN before CLOSED
      this.vacancyRepository.find({ where: { hrUserId: hr.id }, order: { status: 'ASC', updatedAt: 'DESC' } }),
      this.pipelineService.counts(hr.id),
    ]);
    const views = vacancies.map((v) => this.toView(v, counts));
    const unassigned = counts.filter((c) => c.vacancyId === null).reduce((sum, c) => sum + c.count, 0);
    return { vacancies: views, unassigned };
  }

  async create(hr: User, dto: CreateVacancyDto): Promise<VacancyView> {
    await this.assertCanOpen(hr.id);
    const vacancy = await this.vacancyRepository.save(this.vacancyRepository.create({ hrUserId: hr.id, title: dto.title }));
    return this.toView(vacancy, []);
  }

  async update(hr: User, id: number, dto: UpdateVacancyDto): Promise<VacancyView> {
    const vacancy = await this.findOwned(hr.id, id);
    if (dto.status === HrVacancyStatus.OPEN && vacancy.status !== HrVacancyStatus.OPEN) await this.assertCanOpen(hr.id);

    await this.vacancyRepository.update(id, {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.status !== undefined && { status: dto.status }),
    });
    const saved = await this.vacancyRepository.findOneByOrFail({ id });
    return this.toView(saved, await this.pipelineService.counts(hr.id));
  }

  /** Candidates stay unlocked: the ones not in another vacancy move to "no vacancy". */
  async remove(hr: User, id: number): Promise<void> {
    await this.findOwned(hr.id, id);
    await this.pipelineService.detachVacancy(hr.id, id);
    await this.vacancyRepository.delete(id);
  }

  async findOwned(hrUserId: number, id: number): Promise<HrVacancy> {
    const vacancy = await this.vacancyRepository.findOne({ where: { id, hrUserId } });
    if (!vacancy) throw new NotFoundException('Vacancy not found');
    return vacancy;
  }

  /** Recently used vacancies are listed first: adding a candidate counts as an update. */
  touch(id: number) {
    return this.vacancyRepository.update(id, { updatedAt: new Date() });
  }

  private async assertCanOpen(hrUserId: number) {
    const open = await this.vacancyRepository.count({ where: { hrUserId, status: HrVacancyStatus.OPEN } });
    if (open >= MAX_OPEN_VACANCIES) {
      throw new BadRequestException(`ღია ვაკანსიების ლიმიტი (${MAX_OPEN_VACANCIES}) ამოიწურა, დახურეთ ძველი ვაკანსია`);
    }
  }

  private toView(v: HrVacancy, counts: { vacancyId: number | null; stage: PipelineStage; count: number }[]): VacancyView {
    const stages: Partial<Record<PipelineStage, number>> = {};
    let total = 0;
    for (const c of counts) {
      if (c.vacancyId !== v.id) continue;
      stages[c.stage] = c.count;
      total += c.count;
    }
    return { id: v.id, title: v.title, status: v.status, createdAt: v.createdAt, updatedAt: v.updatedAt, total, stages };
  }
}
