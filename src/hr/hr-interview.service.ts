import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { User } from 'src/Entities/user.entity';
import { Cv } from 'src/Entities/cv.entity';
import { HrVacancy, HrVacancyStatus } from 'src/Entities/hr-vacancy.entity';
import { HrInterview, InterviewFormat, InterviewStatus } from 'src/Entities/hr-interview.entity';
import { HrPipelineEntry, PipelineStage } from 'src/Entities/hr-pipeline-entry.entity';
import { PipelineEventType } from 'src/Entities/hr-pipeline-event.entity';
import { HrCvAccess, HrCvAccessAction } from 'src/Entities/hr-cv-access.entity';
import { EmailService } from 'src/email/email.service';
import { CvService } from 'src/cv/cv.service';
import { HrPipelineService, PipelineView, toView } from './hr-pipeline.service';
import { CalendarEvent, GoogleCalendarService } from './google-calendar.service';
import {
  InterviewAnswerDto,
  InterviewJoinDto,
  InviteInterviewDto,
  ScheduleInterviewDto,
  UpdateInterviewDto,
} from './dto/hr-interview.dto';
import {
  AnswerError,
  applyAnswer,
  cleanTimes,
  frontendUrl,
  interviewLink,
  isValidStart,
  newLinkNonce,
  tokenId,
  tokenMatches,
} from './interview';
import {
  cancelledEmail,
  confirmedEmail,
  hrAnswerEmail,
  hrReminderEmail,
  InterviewMailData,
  inviteEmail,
  MailContent,
  reminderEmail,
} from './interview-email';

export const INTERVIEW_QUEUE = 'hr-interview';
export interface ReminderJob {
  interviewId: number;
  /** The interview time the reminder was planned for; a rescheduled interview ignores old reminders */
  startsAt: number;
  hours: number;
}
const REMINDER_HOURS = [24, 1];
// Interviews shown to the HR: upcoming ones and those of the last month
const LIST_FROM_DAYS = 30;
// An invitation link works this long for joining; once someone joined it's their answer link
export const INVITE_TTL_MS = 24 * 3600 * 1000;
const inviteExpired = (iv: HrInterview, now = Date.now()) =>
  iv.cvId === null && !!iv.inviteExpiresAt && iv.inviteExpiresAt.getTime() <= now;
const expiredLink = () =>
  new BadRequestException({ statusCode: 400, message: 'მოწვევის ბმულს ვადა გაუვიდა: სთხოვეთ HR-ს ახალი ბმული', code: 'INVITE_EXPIRED' });

export interface InterviewView {
  id: number;
  /** Null while an invited candidate hasn't joined (no card yet) */
  entryId: number | null;
  cvId: number | null;
  vacancyId: number | null;
  inviteeName: string | null;
  inviteeEmail: string | null;
  /** Invitation link nobody joined through yet: works until then */
  inviteExpiresAt: Date | null;
  /** Set on invitations: the position the HR invited for */
  position: string | null;
  startsAt: Date;
  durationMin: number;
  format: HrInterview['format'];
  location: string;
  message: string | null;
  alternatives: Date[];
  status: InterviewStatus;
  candidateNote: string | null;
  /** Declined because none of the offered times suits them */
  timeConflict: boolean;
  /** Older answers: times the candidate proposed (candidates no longer propose times) */
  proposedTimes: Date[];
  sentTo: string | null;
  respondedAt: Date | null;
  createdAt: Date;
  /** `location` is a Google Meet link generated in the HR's calendar */
  googleMeet: boolean;
  /** The candidate's answer page, for sharing it another way (phone, messenger) */
  link: string;
}

/** What the candidate's answer page shows. */
export interface PublicInterview {
  status: InterviewStatus;
  startsAt: Date;
  durationMin: number;
  format: HrInterview['format'];
  location: string;
  message: string | null;
  alternatives: { slot: number; startsAt: Date }[];
  proposedTimes: Date[];
  candidateNote: string | null;
  timeConflict: boolean;
  position: string;
  company: string;
  hrName: string;
  candidateName: string;
  /** False once the interview has started or was cancelled */
  canRespond: boolean;
  /** Invited candidate not on the platform yet: accepting asks for their details and CV */
  needsProfile: boolean;
  /** The invitation link's day is over before anyone joined: the HR has to send a new one */
  inviteExpired: boolean;
  /** Prefill for that form: who asked for other times, and where the invitation went */
  inviteeName: string | null;
  inviteeEmail: string | null;
}

const ANSWER_EVENT: Partial<Record<InterviewStatus, PipelineEventType>> = {
  [InterviewStatus.CONFIRMED]: PipelineEventType.INTERVIEW_CONFIRMED,
  [InterviewStatus.DECLINED]: PipelineEventType.INTERVIEW_DECLINED,
  [InterviewStatus.RESCHEDULE_REQUESTED]: PipelineEventType.INTERVIEW_RESCHEDULE_REQUESTED,
};

/**
 * Interviews for board cards: the HR schedules one (optionally emailing the invitation), the candidate
 * answers through the emailed link, both get reminders. Every step lands in the card's history.
 */
@Injectable()
export class HrInterviewService {
  private readonly logger = new Logger(HrInterviewService.name);

  constructor(
    @InjectRepository(HrInterview) private readonly interviewRepository: Repository<HrInterview>,
    @InjectRepository(Cv) private readonly cvRepository: Repository<Cv>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(HrVacancy) private readonly vacancyRepository: Repository<HrVacancy>,
    @InjectRepository(HrCvAccess) private readonly accessRepository: Repository<HrCvAccess>,
    private readonly pipelineService: HrPipelineService,
    private readonly cvService: CvService,
    private readonly emailService: EmailService,
    private readonly googleCalendar: GoogleCalendarService,
    @InjectQueue(INTERVIEW_QUEUE) private readonly queue: Queue,
  ) {}

  /** This HR's interviews from the last month on, soonest first (cancelled ones left out). */
  async list(hr: User): Promise<InterviewView[]> {
    const from = new Date(Date.now() - LIST_FROM_DAYS * 24 * 3600 * 1000);
    const rows = await this.interviewRepository.find({
      where: { hrUserId: hr.id, status: Not(InterviewStatus.CANCELLED), startsAt: MoreThanOrEqual(from) },
      order: { startsAt: 'ASC' },
      take: 500,
    });
    return rows.map((iv) => this.toView(iv));
  }

  /**
   * Schedules an interview for a card, moves it to INTERVIEW and (by default) emails the invitation.
   * With googleMeet, each interview gets its own Meet link (candidates never share a meeting).
   */
  async schedule(hr: User, entryId: number, dto: ScheduleInterviewDto): Promise<{ interview: InterviewView; pipeline: PipelineView }> {
    const entry = await this.pipelineService.findOwned(hr.id, entryId);
    const now = new Date();
    const open = await this.interviewRepository.findOne({
      where: { entryId, status: In([InterviewStatus.PENDING, InterviewStatus.CONFIRMED, InterviewStatus.RESCHEDULE_REQUESTED]), startsAt: MoreThanOrEqual(now) },
    });
    if (open) throw new ConflictException('ამ კანდიდატს უკვე აქვს დაგეგმილი გასაუბრება');

    const startsAt = new Date(dto.startsAt);
    if (!isValidStart(startsAt, now)) throw new BadRequestException('აირჩიეთ მომავალი თარიღი');
    const alternatives = this.cleanAlternatives(dto.alternatives, startsAt, now);
    const send = dto.send !== false;
    const candidate = (await this.candidateByCv(entry.cvId)) ?? { name: '', email: null, role: '' };
    if (send && !candidate.email) throw new BadRequestException('კანდიდატს ელ-ფოსტა არ აქვს: შეინახეთ გაგზავნის გარეშე');

    let interview = await this.interviewRepository.save(
      this.interviewRepository.create({
        hrUserId: hr.id,
        entryId,
        cvId: entry.cvId,
        vacancyId: entry.vacancyId,
        startsAt,
        durationMin: dto.durationMin ?? 45,
        format: dto.format,
        location: dto.location?.trim() ?? '',
        message: dto.message?.trim() || null,
        alternatives,
        linkNonce: newLinkNonce(),
        sentTo: send ? candidate.email : null,
      }),
    );

    // Don't leave an interview (or calendar event) the HR was told failed: retrying would hit "already scheduled"
    let pipeline: PipelineView;
    try {
      // Before the email, so the invitation carries the link
      if (dto.googleMeet && dto.format === InterviewFormat.ONLINE) interview = await this.addMeet(interview);
      pipeline =
        entry.stage === PipelineStage.INTERVIEW
          ? toView(entry)
          : await this.pipelineService.update(hr, entryId, { stage: PipelineStage.INTERVIEW });
    } catch (error) {
      await this.dropMeet(interview);
      await this.interviewRepository.delete(interview.id);
      throw error;
    }
    try {
      await this.pipelineService.recordEvent(entry, { type: PipelineEventType.INTERVIEW_SCHEDULED, interviewAt: startsAt });
    } catch (error) {
      // The interview stands; a missing history line isn't worth failing the request over
      this.logger.error(`Could not record interview ${interview.id} in the history: ${error.message}`);
    }
    if (send) {
      try {
        await this.mailCandidate(interview, (d) => inviteEmail(d));
      } catch (error) {
        this.logger.error(`Could not email the invitation for interview ${interview.id}: ${error.message}`);
      }
    }

    return { interview: this.toView(interview), pipeline };
  }

  /**
   * An interview invitation as a link the HR shares themselves: the HR doesn't need to know who it's for.
   * It works for one person for a day: accepting asks for their details and CV, and they land on the
   * board at "Interview" (see join). No card until then.
   */
  async invite(hr: User, dto: InviteInterviewDto): Promise<InterviewView> {
    const now = new Date();
    const startsAt = new Date(dto.startsAt);
    if (!isValidStart(startsAt, now)) throw new BadRequestException('აირჩიეთ მომავალი თარიღი');
    const alternatives = this.cleanAlternatives(dto.alternatives, startsAt, now);

    let vacancyId: number | null = null;
    let position = dto.position?.replace(/\s+/g, ' ').trim() || '';
    if (dto.vacancyId !== undefined && dto.vacancyId !== null) {
      const vacancy = await this.vacancyRepository.findOne({ where: { id: dto.vacancyId, hrUserId: hr.id } });
      if (!vacancy) throw new NotFoundException('Vacancy not found');
      if (vacancy.status !== HrVacancyStatus.OPEN) throw new BadRequestException('ვაკანსია დახურულია');
      vacancyId = vacancy.id;
      // On a vacancy's board the position is that vacancy, unless the HR typed another
      position ||= vacancy.title;
    }
    // The candidate's page and emails name it; without a vacancy nothing else would
    if (!position) throw new BadRequestException('მიუთითეთ პოზიცია');

    let interview = await this.interviewRepository.save(
      this.interviewRepository.create({
        hrUserId: hr.id,
        entryId: null,
        cvId: null,
        vacancyId,
        inviteeName: null,
        inviteeEmail: null,
        inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        position,
        startsAt,
        durationMin: dto.durationMin ?? 45,
        format: dto.format,
        location: dto.location?.trim() ?? '',
        message: dto.message?.trim() || null,
        alternatives,
        linkNonce: newLinkNonce(),
        sentTo: null,
      }),
    );
    try {
      if (dto.googleMeet && dto.format === InterviewFormat.ONLINE) interview = await this.addMeet(interview);
    } catch (error) {
      await this.interviewRepository.delete(interview.id);
      throw error;
    }
    return this.toView(interview);
  }

  /**
   * An invited candidate accepts one of the offered times with their details and CV: the CV is saved and
   * AI-summarized, opened to the HR (no quota), put on the vacancy's board at "Interview", then the answer
   * is recorded as for any candidate. Already joined: it's just the answer.
   */
  async join(token: string, dto: InterviewJoinDto, file: Express.Multer.File): Promise<PublicInterview> {
    const interview = await this.byToken(token);
    const answer: InterviewAnswerDto = { action: dto.action, slot: dto.slot };
    // Someone already joined: the link is theirs now, so this is just an answer
    if (interview.cvId !== null) return this.answer(token, answer);
    if (inviteExpired(interview)) throw expiredLink();
    if (!dto.consent) throw new BadRequestException('საჭიროა თანხმობა CV-ის შენახვაზე');
    // Same checks as the answer itself, before storing anything (cancelled, already started, bad times)
    try {
      applyAnswer(interview, answer, new Date());
    } catch (error) {
      if (error instanceof AnswerError) throw new BadRequestException({ statusCode: 400, message: error.message, code: error.code });
      throw error;
    }

    const hr = await this.userRepository.findOne({ where: { id: interview.hrUserId } });
    if (!hr) throw new NotFoundException('ბმული არასწორია ან ვადაგასულია');

    const cv = await this.cvService.saveInvitedCandidateCv(
      { email: dto.email, fullName: dto.fullName, phoneNumber: dto.phoneNumber },
      file,
    );
    const contacts = { hrUserId: hr.id, cvId: cv.id, action: HrCvAccessAction.INVITED };
    if (!(await this.accessRepository.exists({ where: contacts }))) await this.accessRepository.insert(contacts);

    // The vacancy may have been deleted since: then the main board
    const vacancyId = interview.vacancyId && (await this.vacancyRepository.exists({ where: { id: interview.vacancyId } })) ? interview.vacancyId : null;
    let entry: HrPipelineEntry = await this.pipelineService.placeCandidate(hr.id, cv.id, vacancyId);
    if (entry.stage !== PipelineStage.INTERVIEW) {
      await this.pipelineService.update(hr, entry.id, { stage: PipelineStage.INTERVIEW });
      entry = await this.pipelineService.findOwned(hr.id, entry.id);
    }

    Object.assign(interview, {
      cvId: cv.id,
      entryId: entry.id,
      vacancyId: entry.vacancyId,
      inviteeName: dto.fullName.trim(),
      sentTo: interview.sentTo ?? cv.email,
    });
    await this.interviewRepository.save(interview);
    await this.pipelineService
      .recordEvent(entry, { type: PipelineEventType.INTERVIEW_SCHEDULED, interviewAt: interview.startsAt, note: 'შემოუერთდა მოწვევით' })
      .catch((error) => this.logger.error(`Could not record joining for interview ${interview.id}: ${error.message}`));

    return this.answer(token, answer);
  }

  /** Reschedule/edit, accept one of the candidate's proposed times, or cancel. */
  async update(hr: User, id: number, dto: UpdateInterviewDto): Promise<InterviewView> {
    let interview = await this.interviewRepository.findOne({ where: { id, hrUserId: hr.id } });
    if (!interview) throw new NotFoundException('Interview not found');
    if (interview.status === InterviewStatus.CANCELLED) throw new BadRequestException('გასაუბრება უკვე გაუქმებულია');
    // An invitation nobody has joined yet has no card (and no history) to update
    const entry = interview.entryId !== null ? await this.pipelineService.findOwned(hr.id, interview.entryId) : null;
    const recordEvent = (event: Parameters<HrPipelineService['recordEvent']>[1]) =>
      entry ? this.pipelineService.recordEvent(entry, event) : Promise.resolve();
    const notify = dto.notify !== false;
    const now = new Date();

    if (dto.cancel) {
      interview.status = InterviewStatus.CANCELLED;
      await this.dropMeet(interview);
      const saved = await this.interviewRepository.save(interview);
      await recordEvent({ type: PipelineEventType.INTERVIEW_CANCELLED, interviewAt: saved.startsAt });
      if (notify && saved.sentTo && saved.startsAt > now) await this.mailCandidate(saved, cancelledEmail);
      return this.toView(saved);
    }

    if (dto.renewLink) {
      if (interview.cvId !== null) throw new BadRequestException('კანდიდატი უკვე შემოუერთდა მოწვევით');
      // A new nonce: the old link (maybe forwarded somewhere) stops working
      Object.assign(interview, { linkNonce: newLinkNonce(), inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_MS) });
      return this.toView(await this.interviewRepository.save(interview));
    }

    if (dto.acceptProposed !== undefined) {
      const chosen = interview.proposedTimes[dto.acceptProposed];
      if (!chosen || chosen <= now) throw new BadRequestException('ეს დრო აღარ არის ხელმისაწვდომი');
      Object.assign(interview, { startsAt: chosen, status: InterviewStatus.CONFIRMED, proposedTimes: [], alternatives: [], candidateNote: null, timeConflict: false });
      const saved = await this.interviewRepository.save(interview);
      await this.syncMeet(saved);
      // Signed by the HR: "confirmed" events in the history are the candidate's own answers
      await recordEvent({ type: PipelineEventType.INTERVIEW_UPDATED, interviewAt: chosen });
      if (notify) await this.mailCandidate(saved, confirmedEmail, true);
      await this.planReminders(saved);
      return this.toView(saved);
    }

    // Edit: new times need the candidate's answer again
    const edited = interview;
    const offeredTimes = () => [edited.startsAt, ...edited.alternatives].map((d) => d.getTime()).join();
    const startBefore = interview.startsAt.getTime();
    const timesBefore = offeredTimes();
    if (dto.startsAt !== undefined) {
      const startsAt = new Date(dto.startsAt);
      if (!isValidStart(startsAt, now)) throw new BadRequestException('აირჩიეთ მომავალი თარიღი');
      interview.startsAt = startsAt;
    }
    if (dto.durationMin !== undefined) interview.durationMin = dto.durationMin;
    if (dto.format !== undefined) interview.format = dto.format;
    if (dto.message !== undefined) interview.message = dto.message?.trim() || null;
    if (dto.alternatives !== undefined) interview.alternatives = this.cleanAlternatives(dto.alternatives, interview.startsAt, now);
    // A moved time, or other variants for a candidate who hasn't confirmed (e.g. none of the times suited them)
    const reask =
      interview.startsAt.getTime() !== startBefore || (interview.status !== InterviewStatus.CONFIRMED && offeredTimes() !== timesBefore);
    if (reask) {
      Object.assign(interview, { status: InterviewStatus.PENDING, proposedTimes: [], candidateNote: null, timeConflict: false, respondedAt: null });
      // An invitee whose link still expires (older answers) gets another day to answer through it
      if (interview.cvId === null && interview.inviteExpiresAt) interview.inviteExpiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    }

    // A generated Meet link stays (its event follows the new time) until the HR turns it off or goes on site
    const hadMeet = !!interview.googleEventId;
    const wantsMeet = (dto.googleMeet ?? hadMeet) && interview.format === InterviewFormat.ONLINE;
    if (hadMeet && !wantsMeet) {
      await this.dropMeet(interview);
      interview.location = dto.location?.trim() ?? '';
    } else if (!hadMeet && dto.location !== undefined) {
      interview.location = dto.location.trim();
    }
    // Before saving: if Google fails, nothing changes
    if (wantsMeet && !hadMeet) interview = await this.addMeet(interview, false);

    let saved = await this.interviewRepository.save(interview);
    if (hadMeet && wantsMeet) await this.syncMeet(saved);
    await recordEvent({ type: PipelineEventType.INTERVIEW_UPDATED, interviewAt: saved.startsAt });
    if (notify) {
      // Also how an invitation saved without sending goes out later
      const sent = await this.mailCandidate(saved, (d) => inviteEmail(d, !!saved.sentTo), true);
      if (sent && !saved.sentTo) saved = await this.interviewRepository.save({ ...saved, sentTo: sent });
    }
    if (saved.status === InterviewStatus.CONFIRMED) await this.planReminders(saved);
    return this.toView(saved);
  }

  async publicView(token: string): Promise<PublicInterview> {
    const interview = await this.byToken(token);
    const d = await this.mailData(interview);
    const now = Date.now();
    return {
      status: interview.status,
      startsAt: interview.startsAt,
      durationMin: interview.durationMin,
      format: interview.format,
      location: interview.location,
      message: interview.message,
      alternatives: interview.alternatives
        .map((startsAt, slot) => ({ slot, startsAt }))
        .filter((a) => a.startsAt.getTime() > now),
      proposedTimes: interview.proposedTimes,
      candidateNote: interview.candidateNote,
      timeConflict: interview.timeConflict,
      position: d.position,
      company: d.company,
      hrName: d.hrName,
      candidateName: d.candidateName.split(/\s+/)[0] ?? '',
      canRespond: interview.status !== InterviewStatus.CANCELLED && interview.startsAt.getTime() > now && !inviteExpired(interview, now),
      needsProfile: interview.cvId === null,
      inviteExpired: inviteExpired(interview, now),
      inviteeName: interview.cvId === null ? interview.inviteeName : null,
      inviteeEmail: interview.cvId === null ? interview.inviteeEmail : null,
    };
  }

  /** The candidate's answer from the link. Repeating the same answer changes nothing and sends nothing. */
  async answer(token: string, dto: InterviewAnswerDto): Promise<PublicInterview> {
    const interview = await this.byToken(token);
    // An invitee accepts through join (with their CV); declining needs no details
    if (inviteExpired(interview)) throw expiredLink();
    if (interview.cvId === null && dto.action === 'confirm') {
      throw new BadRequestException({ statusCode: 400, message: 'შეავსეთ თქვენი მონაცემები და ატვირთეთ CV', code: 'PROFILE_REQUIRED' });
    }
    // An invitee asking for other times leaves a name and email: the new times are emailed to them,
    // and the link is theirs from then on (no expiry, as after joining). The CV comes when they confirm.
    let claim: Partial<HrInterview> = {};
    if (interview.cvId === null && dto.action === 'reschedule') {
      const fullName = dto.fullName?.replace(/\s+/g, ' ').trim();
      const email = dto.email?.trim();
      if (!fullName || !email) {
        throw new BadRequestException({ statusCode: 400, message: 'მიუთითეთ სახელი და ელ-ფოსტა', code: 'CONTACT_REQUIRED' });
      }
      claim = { inviteeName: fullName, inviteeEmail: email, sentTo: email, inviteExpiresAt: null };
    }
    let result: ReturnType<typeof applyAnswer>;
    try {
      result = applyAnswer(interview, dto, new Date());
    } catch (error) {
      if (error instanceof AnswerError) throw new BadRequestException({ statusCode: 400, message: error.message, code: error.code });
      throw error;
    }
    const claimChanged = Object.entries(claim).some(([key, value]) => interview[key as keyof HrInterview] !== value);
    if (!result.changed && !claimChanged) return this.publicView(token);

    const moved = result.state.startsAt.getTime() !== interview.startsAt.getTime();
    Object.assign(interview, result.state, claim, { respondedAt: new Date() });
    const saved = await this.interviewRepository.save(interview);
    // Confirmed one of the HR's alternative times
    if (moved) await this.syncMeet(saved);
    const entry = saved.entryId !== null ? await this.pipelineService.findOwned(saved.hrUserId, saved.entryId).catch(() => null) : null;
    const type = ANSWER_EVENT[saved.status];
    if (entry && type) {
      const note = [saved.timeConflict && 'დრო არ მოერგო', saved.candidateNote].filter(Boolean).join(' · ') || null;
      await this.pipelineService.recordEvent(entry, { type, interviewAt: saved.startsAt, note });
    }

    await this.mailHr(saved, (d) => hrAnswerEmail(d, saved.status));
    if (saved.status === InterviewStatus.CONFIRMED) {
      await this.mailCandidate(saved, confirmedEmail, true);
      await this.planReminders(saved);
    }
    return this.publicView(token);
  }

  /** Runs from the queue: still confirmed and still at the planned time? Then remind both sides. */
  async sendReminder(job: ReminderJob) {
    const interview = await this.interviewRepository.findOne({ where: { id: job.interviewId } });
    if (!interview || interview.status !== InterviewStatus.CONFIRMED || interview.startsAt.getTime() !== job.startsAt) return;
    if (interview.sentTo) await this.mailCandidate(interview, (d) => reminderEmail(d, job.hours));
    await this.mailHr(interview, (d) => hrReminderEmail(d, job.hours));
  }

  // ─── Helpers ──────────────────────────────────────────────────

  /** Creates the interview's Google event and makes its Meet link the location. */
  private async addMeet(interview: HrInterview, save = true): Promise<HrInterview> {
    const { eventId, meetUrl } = await this.googleCalendar.createMeet(interview.hrUserId, await this.calendarEvent(interview));
    Object.assign(interview, { googleEventId: eventId, location: meetUrl });
    return save ? this.interviewRepository.save(interview) : interview;
  }

  /** Moves the Google event to the interview's current time. The link works either way, so failures only get logged. */
  private async syncMeet(interview: HrInterview) {
    if (!interview.googleEventId) return;
    try {
      await this.googleCalendar.updateEvent(interview.hrUserId, interview.googleEventId, await this.calendarEvent(interview));
    } catch (error) {
      this.logger.error(`Could not move the Google event of interview ${interview.id}: ${error.message}`);
    }
  }

  /** Deletes the Google event (best effort) and forgets it. */
  private async dropMeet(interview: HrInterview) {
    if (!interview.googleEventId) return;
    try {
      await this.googleCalendar.deleteEvent(interview.hrUserId, interview.googleEventId);
    } catch (error) {
      this.logger.error(`Could not delete the Google event of interview ${interview.id}: ${error.message}`);
    }
    interview.googleEventId = null;
  }

  /** The event in the HR's own calendar: who and for what, plus where to manage it. */
  private async calendarEvent(interview: HrInterview): Promise<CalendarEvent> {
    const d = await this.mailData(interview);
    const who = d.candidateName || 'კანდიდატი';
    return {
      summary: `გასაუბრება: ${who} · ${d.position}`,
      description: [`კანდიდატი: ${who}${d.candidateEmail ? ` (${d.candidateEmail})` : ''}`, `Job Up: ${frontendUrl()}/hr/interviews`].join('\n'),
      startsAt: interview.startsAt,
      durationMin: interview.durationMin,
    };
  }

  private cleanAlternatives(values: string[] | undefined, startsAt: Date, now: Date): Date[] {
    const times = cleanTimes(values ?? [], now);
    if (!times) throw new BadRequestException('ალტერნატიული დრო უნდა იყოს მომავალში (მაქსიმუმ 3)');
    return times.filter((t) => t.getTime() !== startsAt.getTime());
  }

  private async byToken(token: string): Promise<HrInterview> {
    const id = tokenId(token);
    const interview = id ? await this.interviewRepository.findOne({ where: { id } }) : null;
    if (!interview || !tokenMatches(token, interview.id, interview.linkNonce)) throw new NotFoundException('ბმული არასწორია ან ვადაგასულია');
    return interview;
  }

  private async planReminders(interview: HrInterview) {
    const startsAt = interview.startsAt.getTime();
    for (const hours of REMINDER_HOURS) {
      const delay = startsAt - hours * 3600 * 1000 - Date.now();
      if (delay <= 0) continue;
      const data: ReminderJob = { interviewId: interview.id, startsAt, hours };
      await this.queue
        .add('reminder', data, {
          delay,
          // One job per interview time: re-confirming doesn't duplicate, a new time gets new jobs
          jobId: `interview-${interview.id}-${hours}h-${startsAt}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 3600 },
        })
        .catch((error) => this.logger.error(`Could not plan reminder for interview ${interview.id}: ${error.message}`));
    }
  }

  /** Emails the candidate (Reply-To: the HR). Returns the address used, or null if there is none. */
  private async mailCandidate(
    interview: HrInterview,
    build: (d: InterviewMailData) => MailContent,
    anyAddress = false,
  ): Promise<string | null> {
    const d = await this.mailData(interview);
    const to = interview.sentTo ?? (anyAddress ? d.candidateEmail : null);
    if (!to) return null;
    await this.queueMail(to, build(d), `${d.company || d.hrName} · Job Up`, { email: d.hrEmail, name: d.hrName });
    return to;
  }

  private async mailHr(interview: HrInterview, build: (d: InterviewMailData) => MailContent) {
    const d = await this.mailData(interview);
    if (!d.hrEmail) return;
    await this.queueMail(d.hrEmail, build(d), 'Job Up', d.candidateEmail ? { email: d.candidateEmail, name: d.candidateName } : undefined);
  }

  private async queueMail(to: string, mail: MailContent, senderName: string, replyTo?: { email: string; name?: string }) {
    try {
      await this.emailService.queueEmail(to, mail.subject, mail.html, undefined, senderName, {
        replyTo,
        attachments: mail.ics ? [{ name: 'interview.ics', content: Buffer.from(mail.ics).toString('base64') }] : undefined,
      });
    } catch (error) {
      // The interview is saved either way; the HR sees the state on the board
      this.logger.error(`Could not queue interview email to ${to}: ${error.message}`);
    }
  }

  /** The interview's candidate; for an invitation nobody has joined yet, what the HR entered. */
  private async candidate(interview: HrInterview): Promise<{ name: string; email: string | null; role: string }> {
    const fromCv = interview.cvId !== null ? await this.candidateByCv(interview.cvId) : null;
    return fromCv ?? { name: interview.inviteeName ?? '', email: interview.inviteeEmail, role: '' };
  }

  private async candidateByCv(cvId: number): Promise<{ name: string; email: string | null; role: string } | null> {
    const cv = await this.cvRepository.findOne({ where: { id: cvId } });
    if (!cv) return null;
    const user = cv.userId
      ? await this.userRepository.findOne({ where: { id: cv.userId }, select: ['id', 'firstName', 'lastName', 'email'] })
      : null;
    return {
      name: (user ? `${user.firstName} ${user.lastName}` : (cv.fullName ?? '')).trim(),
      email: (user ? user.email : cv.email) || null,
      role: cv.summary?.detectedRole ?? '',
    };
  }

  private async mailData(interview: HrInterview): Promise<InterviewMailData & { candidateEmail: string | null }> {
    const [candidate, hr, vacancy] = await Promise.all([
      this.candidate(interview),
      this.userRepository.findOne({ where: { id: interview.hrUserId }, select: ['id', 'firstName', 'lastName', 'email', 'companyName'] }),
      interview.vacancyId ? this.vacancyRepository.findOne({ where: { id: interview.vacancyId } }) : null,
    ]);
    return {
      id: interview.id,
      candidateName: candidate.name,
      candidateEmail: candidate.email,
      position: interview.position || vacancy?.title || candidate.role || 'გასაუბრება',
      company: hr?.companyName ?? '',
      hrName: hr ? `${hr.firstName} ${hr.lastName}`.trim() : '',
      hrEmail: hr?.email ?? '',
      startsAt: interview.startsAt,
      durationMin: interview.durationMin,
      format: interview.format,
      location: interview.location,
      message: interview.message,
      alternatives: interview.alternatives,
      candidateNote: interview.candidateNote,
      timeConflict: interview.timeConflict,
      link: interviewLink(interview.id, interview.linkNonce),
      sequence: Math.floor((interview.updatedAt ?? new Date()).getTime() / 1000),
      newCandidate: interview.cvId === null,
    };
  }

  private toView(iv: HrInterview): InterviewView {
    return {
      id: iv.id,
      entryId: iv.entryId,
      cvId: iv.cvId,
      vacancyId: iv.vacancyId,
      inviteeName: iv.inviteeName,
      inviteeEmail: iv.inviteeEmail,
      inviteExpiresAt: iv.cvId === null ? iv.inviteExpiresAt : null,
      position: iv.position,
      startsAt: iv.startsAt,
      durationMin: iv.durationMin,
      format: iv.format,
      location: iv.location,
      message: iv.message,
      alternatives: iv.alternatives,
      status: iv.status,
      candidateNote: iv.candidateNote,
      timeConflict: iv.timeConflict,
      proposedTimes: iv.proposedTimes,
      sentTo: iv.sentTo,
      respondedAt: iv.respondedAt,
      createdAt: iv.createdAt,
      googleMeet: !!iv.googleEventId,
      link: interviewLink(iv.id, iv.linkNonce),
    };
  }
}

