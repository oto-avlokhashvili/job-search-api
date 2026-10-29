import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Cv } from 'src/Entities/cv.entity';
import { User } from 'src/Entities/user.entity';
import { CONTACT_ACCESS, HrCvAccess, HrCvAccessAction } from 'src/Entities/hr-cv-access.entity';
import { UserRole } from 'src/enums/user-role.enum';
import { HrVacancyStatus } from 'src/Entities/hr-vacancy.entity';
import { R2StorageService } from 'src/cv/r2-storage.service';
import { PublicCvLimitsService } from 'src/cv/public-cv-limits.service';
import { LinkedinSearchService } from 'src/linkedin-search/linkedin-search.service';
import { LinkedinSearchDto } from 'src/linkedin-search/dto/linkedin-search.dto';
import { HrCandidateSearchDto } from './dto/hr-candidate-search.dto';
import { CreateManualCandidateDto } from './dto/hr-vacancy.dto';
import { scoreCvForCriteria } from './candidate-score';
import { BoardFilter, HrPipelineService, PipelineView, toView, VacancyMembership } from './hr-pipeline.service';
import { HrVacancyService } from './hr-vacancy.service';

const DAY_SEC = 24 * 60 * 60;
const envInt = (name: string, fallback: number) => Number(process.env[name]) || fallback;
export const HR_CV_UNLOCKS_PER_MONTH = envInt('HR_CV_UNLOCKS_PER_MONTH', 50);
export const HR_LINKEDIN_SEARCHES_PER_DAY = envInt('HR_LINKEDIN_SEARCHES_PER_DAY', 30);
const HR_CV_SEARCHES_PER_HOUR = envInt('HR_CV_SEARCHES_PER_HOUR', 120);
// The SQL prefilter (keyword anywhere in the summary) bounds how many CVs get scored in memory.
const PREFILTER_LIMIT = 2000;
const MAX_RANKED = 200;

export interface CandidateContact {
  fullName: string | null;
  email: string | null;
  phoneNumber: string | null;
}

/** Anonymized CV card: summary only. Contacts are filled in once this HR has unlocked the CV. */
export interface HrCandidate {
  id: number;
  detectedRole: string;
  seniorityLevel: string;
  careerDirection: string;
  primarySkills: string[];
  secondarySkills: string[];
  domains: string[];
  locationPreference: string;
  updatedAt: Date;
  match?: number;
  matchedKeywords?: string[];
  unlocked: boolean;
  contact: CandidateContact | null;
  /** This HR's vacancies the CV is in (unlocked CVs only). */
  vacancies: VacancyMembership[];
  /** Added by hand by this HR: name and position only, no file or AI summary */
  manual: boolean;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');
const splitKeywords = (keyword: string) =>
  Array.from(new Set(keyword.split(',').map((k) => k.trim()).filter(Boolean))).slice(0, 10);
const startOfMonthUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};
const linkedinQuotaKey = (hrUserId: number) => `hr:linkedin:${hrUserId}:${new Date().toISOString().slice(0, 10)}`;

@Injectable()
export class HrCandidatesService {
  constructor(
    @InjectRepository(Cv) private readonly cvRepository: Repository<Cv>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(HrCvAccess) private readonly accessRepository: Repository<HrCvAccess>,
    private readonly r2StorageService: R2StorageService,
    private readonly limits: PublicCvLimitsService,
    private readonly linkedinSearchService: LinkedinSearchService,
    private readonly pipelineService: HrPipelineService,
    private readonly vacancyService: HrVacancyService,
  ) {}

  /** Ranked, anonymized CVs (every CV with an AI summary is searchable). */
  async searchCvs(hr: User, dto: HrCandidateSearchDto) {
    await this.limits.consume(
      `hr:cv-search:${hr.id}`,
      HR_CV_SEARCHES_PER_HOUR,
      3600,
      'ძიების ლიმიტი ამოიწურა, სცადეთ მოგვიანებით',
    );

    const keywords = splitKeywords(dto.keyword);
    if (!keywords.length) throw new BadRequestException('Enter at least one keyword');

    const cvs = await this.cvRepository
      .createQueryBuilder('cv')
      .where('cv.summary IS NOT NULL')
      // HR-added records are private to their HR (they have no summary either; this is the rule itself)
      .andWhere('cv.addedByHrId IS NULL')
      .andWhere(
        new Brackets((qb) =>
          keywords.forEach((k, i) => qb.orWhere(`cv.summary::text ILIKE :k${i}`, { [`k${i}`]: `%${escapeLike(k)}%` })),
        ),
      )
      .orderBy('cv.updatedAt', 'DESC')
      .take(PREFILTER_LIMIT)
      .getMany();

    const ranked = cvs
      .map((cv) => ({ cv, score: scoreCvForCriteria(cv.summary!, { keywords, location: dto.location, seniority: dto.seniority }) }))
      .filter((r): r is { cv: Cv; score: NonNullable<typeof r.score> } => r.score !== null)
      .sort((a, b) => b.score.match - a.score.match || b.cv.updatedAt.getTime() - a.cv.updatedAt.getTime())
      .slice(0, MAX_RANKED);

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const pageItems = ranked.slice((page - 1) * limit, page * limit);
    const cards = await this.toCards(hr.id, pageItems.map((r) => r.cv));

    return {
      total: ranked.length,
      page,
      limit,
      candidates: cards.map((card, i) => ({ ...card, ...pageItems[i].score })),
    };
  }

  /**
   * Opens a candidate's contacts (and file) for this HR. Re-opening an already unlocked CV is free;
   * a new one counts toward the monthly quota (admins are not limited).
   */
  async unlock(hr: User, cvId: number): Promise<HrCandidate> {
    const cv = await this.findCv(hr.id, cvId);

    if (!(await this.isUnlocked(hr.id, cvId))) {
      if (hr.role !== UserRole.ADMIN && (await this.unlocksThisMonth(hr.id)) >= HR_CV_UNLOCKS_PER_MONTH) {
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `ამ თვეში კონტაქტების გახსნის ლიმიტი (${HR_CV_UNLOCKS_PER_MONTH}) ამოიწურა`,
            limit: HR_CV_UNLOCKS_PER_MONTH,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await this.accessRepository.insert({ hrUserId: hr.id, cvId, action: HrCvAccessAction.UNLOCK });
    }
    await this.pipelineService.ensureEntry(hr.id, cvId);

    const [card] = await this.toCards(hr.id, [cv]);
    return card;
  }

  /** Unlocks the CV if needed (same quota as unlock) and puts it on the vacancy's board. */
  async addToVacancy(hr: User, vacancyId: number, cvId: number): Promise<HrCandidate & { pipeline: PipelineView }> {
    const vacancy = await this.vacancyService.findOwned(hr.id, vacancyId);
    if (vacancy.status !== HrVacancyStatus.OPEN) throw new BadRequestException('ვაკანსია დახურულია');

    await this.unlock(hr, cvId);
    const entry = await this.pipelineService.addToVacancy(hr.id, vacancyId, cvId);
    await this.vacancyService.touch(vacancyId);

    const [card] = await this.toCards(hr.id, [await this.findCv(hr.id, cvId)]);
    return { ...card, pipeline: toView(entry) };
  }

  /**
   * Adds someone by hand (name and position, no CV file): a private record on this HR's main board,
   * and on a vacancy's board when one is given. No quota, never in the candidate search.
   */
  async addManual(hr: User, dto: CreateManualCandidateDto): Promise<HrCandidate & { pipeline: PipelineView }> {
    let vacancyId: number | null = null;
    let position = dto.position?.trim() || '';
    if (dto.vacancyId !== undefined && dto.vacancyId !== null) {
      const vacancy = await this.vacancyService.findOwned(hr.id, dto.vacancyId);
      if (vacancy.status !== HrVacancyStatus.OPEN) throw new BadRequestException('ვაკანსია დახურულია');
      vacancyId = vacancy.id;
      // On a vacancy's board the position is that vacancy, unless the HR typed another
      position ||= vacancy.title;
    }
    if (!position) throw new BadRequestException('მიუთითეთ პოზიცია');

    const cv = await this.cvRepository.save(
      this.cvRepository.create({
        userId: null,
        email: null,
        fullName: `${dto.firstName} ${dto.lastName}`,
        phoneNumber: null,
        fileName: '',
        originalName: '',
        mimeType: '',
        size: 0,
        storagePath: '',
        summary: null,
        // Nobody else sees it, and no file was shared
        consentGiven: false,
        addedByHrId: hr.id,
        manualPosition: position,
      }),
    );
    await this.accessRepository.insert({ hrUserId: hr.id, cvId: cv.id, action: HrCvAccessAction.ADDED });
    const entry = await this.pipelineService.placeCandidate(hr.id, cv.id, vacancyId);
    if (vacancyId !== null) await this.vacancyService.touch(vacancyId);

    const [card] = await this.toCards(hr.id, [cv]);
    return { ...card, pipeline: toView(entry) };
  }

  async download(hr: User, cvId: number): Promise<{ buffer: Buffer; mimeType: string; originalName: string }> {
    const cv = await this.findCv(hr.id, cvId);
    if (!(await this.isUnlocked(hr.id, cvId))) {
      throw new ForbiddenException('Open the candidate\'s contacts before downloading the CV');
    }
    if (!cv.storagePath) throw new NotFoundException('CV file is missing');

    const buffer = await this.r2StorageService.downloadFile(cv.storagePath);
    await this.accessRepository.insert({ hrUserId: hr.id, cvId, action: HrCvAccessAction.DOWNLOAD });
    return { buffer, mimeType: cv.mimeType, originalName: cv.originalName };
  }

  /**
   * Cards of a board, newest first: every entry, one vacancy's, or the ones not in any vacancy.
   * A CV in two vacancies gives two cards. CVs deleted since the unlock drop out.
   */
  async board(hr: User, filter: BoardFilter): Promise<(HrCandidate & { pipeline: PipelineView })[]> {
    if (typeof filter === 'number') await this.vacancyService.findOwned(hr.id, filter);

    const entries = await this.pipelineService.board(hr.id, filter);
    if (!entries.length) return [];

    const ids = Array.from(new Set(entries.map((e) => e.cvId)));
    const cards = await this.toCards(hr.id, await this.cvRepository.find({ where: { id: In(ids) } }));
    const byId = new Map(cards.map((c) => [c.id, c]));
    return entries.filter((e) => byId.has(e.cvId)).map((e) => ({ ...byId.get(e.cvId)!, pipeline: toView(e) }));
  }

  async searchLinkedin(hr: User, dto: LinkedinSearchDto) {
    if (hr.role !== UserRole.ADMIN) {
      await this.limits.consume(
        linkedinQuotaKey(hr.id),
        HR_LINKEDIN_SEARCHES_PER_DAY,
        DAY_SEC,
        `LinkedIn ძიების დღიური ლიმიტი (${HR_LINKEDIN_SEARCHES_PER_DAY}) ამოიწურა, სცადეთ ხვალ`,
      );
    }
    return this.linkedinSearchService.search(dto);
  }

  async usage(hr: User) {
    return {
      cvUnlocks: { used: await this.unlocksThisMonth(hr.id), limit: HR_CV_UNLOCKS_PER_MONTH },
      linkedinSearches: { used: await this.limits.peek(linkedinQuotaKey(hr.id)), limit: HR_LINKEDIN_SEARCHES_PER_DAY },
      unlimited: hr.role === UserRole.ADMIN,
    };
  }

  /** A CV this HR may see: any in the pool, or a hand-added record of their own. */
  private async findCv(hrUserId: number, cvId: number): Promise<Cv> {
    const cv = await this.cvRepository.findOne({ where: { id: cvId } });
    if (!cv || (cv.addedByHrId !== null && cv.addedByHrId !== hrUserId)) throw new NotFoundException('Candidate not found');
    return cv;
  }

  private isUnlocked(hrUserId: number, cvId: number): Promise<boolean> {
    return this.accessRepository.exists({ where: { hrUserId, cvId, action: In(CONTACT_ACCESS) } });
  }

  private async unlocksThisMonth(hrUserId: number): Promise<number> {
    // Distinct CVs, so a double-clicked unlock never counts twice.
    const row = await this.accessRepository
      .createQueryBuilder('a')
      .select('COUNT(DISTINCT a.cvId)', 'count')
      .where('a.hrUserId = :hrUserId', { hrUserId })
      .andWhere('a.action = :action', { action: HrCvAccessAction.UNLOCK })
      .andWhere('a.createdAt >= :from', { from: startOfMonthUtc() })
      .getRawOne<{ count: string }>();
    return Number(row?.count) || 0;
  }

  private async toCards(hrUserId: number, cvs: Cv[]): Promise<HrCandidate[]> {
    if (!cvs.length) return [];

    const unlockedRows = await this.accessRepository.find({
      where: { hrUserId, cvId: In(cvs.map((cv) => cv.id)), action: In(CONTACT_ACCESS) },
      select: ['cvId'],
    });
    const unlocked = new Set(unlockedRows.map((r) => r.cvId));

    // Account CVs keep the name/email on the user, public CVs on the CV row itself.
    const userIds = cvs.filter((cv) => unlocked.has(cv.id) && cv.userId).map((cv) => cv.userId!);
    const users = userIds.length
      ? await this.userRepository.find({ where: { id: In(userIds) }, select: ['id', 'firstName', 'lastName', 'email'] })
      : [];
    const usersById = new Map(users.map((u) => [u.id, u]));
    const memberships = await this.pipelineService.memberships(hrUserId, Array.from(unlocked));

    return cvs.map((cv) => {
      const s = cv.summary;
      const isUnlocked = unlocked.has(cv.id);
      const user = cv.userId ? usersById.get(cv.userId) : undefined;
      return {
        id: cv.id,
        detectedRole: s?.detectedRole ?? cv.manualPosition ?? '',
        seniorityLevel: s?.seniorityLevel ?? '',
        careerDirection: s?.careerDirection ?? '',
        primarySkills: s?.primarySkills ?? [],
        secondarySkills: s?.secondarySkills ?? [],
        domains: s?.domains ?? [],
        locationPreference: s?.locationPreference ?? '',
        updatedAt: cv.updatedAt,
        unlocked: isUnlocked,
        contact: isUnlocked
          ? {
              fullName: user ? `${user.firstName} ${user.lastName}`.trim() : cv.fullName,
              email: user ? user.email : cv.email,
              phoneNumber: cv.phoneNumber,
            }
          : null,
        vacancies: memberships.get(cv.id) ?? [],
        manual: cv.addedByHrId !== null,
      };
    });
  }
}
