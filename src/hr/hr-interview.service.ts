import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { User } from 'src/Entities/user.entity';
import { Cv } from 'src/Entities/cv.entity';
import { HrVacancy } from 'src/Entities/hr-vacancy.entity';
import { HrInterview, InterviewFormat, InterviewStatus } from 'src/Entities/hr-interview.entity';
import { PipelineStage } from 'src/Entities/hr-pipeline-entry.entity';
import { PipelineEventType } from 'src/Entities/hr-pipeline-event.entity';
import { EmailService } from 'src/email/email.service';
import { HrPipelineService, PipelineView, toView } from './hr-pipeline.service';
import { CalendarEvent, GoogleCalendarService } from './google-calendar.service';
import { InterviewAnswerDto, ScheduleInterviewDto, UpdateInterviewDto } from './dto/hr-interview.dto';
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

export interface InterviewView {
  id: number;
  entryId: number;
  cvId: number;
  vacancyId: number | null;
  startsAt: Date;
  durationMin: number;
  format: HrInterview['format'];
  location: string;
  message: string | null;
  alternatives: Date[];
  status: InterviewStatus;
  candidateNote: string | null;
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
  position: string;
  company: string;
  hrName: string;
  candidateName: string;
  /** False once the interview has started or was cancelled */
  canRespond: boolean;
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
    private readonly pipelineService: HrPipelineService,
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
    const candidate = await this.candidate(entry.cvId);
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

  /** Reschedule/edit, accept one of the candidate's proposed times, or cancel. */
  async update(hr: User, id: number, dto: UpdateInterviewDto): Promise<InterviewView> {
    let interview = await this.interviewRepository.findOne({ where: { id, hrUserId: hr.id } });
    if (!interview) throw new NotFoundException('Interview not found');
    if (interview.status === InterviewStatus.CANCELLED) throw new BadRequestException('გასაუბრება უკვე გაუქმებულია');
    const entry = await this.pipelineService.findOwned(hr.id, interview.entryId);
    const notify = dto.notify !== false;
    const now = new Date();

    if (dto.cancel) {
      interview.status = InterviewStatus.CANCELLED;
      await this.dropMeet(interview);
      const saved = await this.interviewRepository.save(interview);
      await this.pipelineService.recordEvent(entry, { type: PipelineEventType.INTERVIEW_CANCELLED, interviewAt: saved.startsAt });
      if (notify && saved.sentTo && saved.startsAt > now) await this.mailCandidate(saved, cancelledEmail);
      return this.toView(saved);
    }

    if (dto.acceptProposed !== undefined) {
      const chosen = interview.proposedTimes[dto.acceptProposed];
      if (!chosen || chosen <= now) throw new BadRequestException('ეს დრო აღარ არის ხელმისაწვდომი');
      Object.assign(interview, { startsAt: chosen, status: InterviewStatus.CONFIRMED, proposedTimes: [], alternatives: [], candidateNote: null });
      const saved = await this.interviewRepository.save(interview);
      await this.syncMeet(saved);
      // Signed by the HR: "confirmed" events in the history are the candidate's own answers
      await this.pipelineService.recordEvent(entry, { type: PipelineEventType.INTERVIEW_UPDATED, interviewAt: chosen });
      if (notify) await this.mailCandidate(saved, confirmedEmail, true);
      await this.planReminders(saved);
      return this.toView(saved);
    }

    // Edit: a new time needs the candidate's confirmation again
    if (dto.startsAt !== undefined) {
      const startsAt = new Date(dto.startsAt);
      if (!isValidStart(startsAt, now)) throw new BadRequestException('აირჩიეთ მომავალი თარიღი');
      if (startsAt.getTime() !== interview.startsAt.getTime()) {
        Object.assign(interview, { startsAt, status: InterviewStatus.PENDING, proposedTimes: [], candidateNote: null, respondedAt: null });
      }
    }
    if (dto.durationMin !== undefined) interview.durationMin = dto.durationMin;
    if (dto.format !== undefined) interview.format = dto.format;
    if (dto.message !== undefined) interview.message = dto.message?.trim() || null;
    if (dto.alternatives !== undefined) interview.alternatives = this.cleanAlternatives(dto.alternatives, interview.startsAt, now);

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
    await this.pipelineService.recordEvent(entry, { type: PipelineEventType.INTERVIEW_UPDATED, interviewAt: saved.startsAt });
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
      position: d.position,
      company: d.company,
      hrName: d.hrName,
      candidateName: d.candidateName.split(/\s+/)[0] ?? '',
      canRespond: interview.status !== InterviewStatus.CANCELLED && interview.startsAt.getTime() > now,
    };
  }

  /** The candidate's answer from the link. Repeating the same answer changes nothing and sends nothing. */
  async answer(token: string, dto: InterviewAnswerDto): Promise<PublicInterview> {
    const interview = await this.byToken(token);
    let result: ReturnType<typeof applyAnswer>;
    try {
      result = applyAnswer(interview, dto, new Date());
    } catch (error) {
      if (error instanceof AnswerError) throw new BadRequestException({ statusCode: 400, message: error.message, code: error.code });
      throw error;
    }
    if (!result.changed) return this.publicView(token);

    const moved = result.state.startsAt.getTime() !== interview.startsAt.getTime();
    Object.assign(interview, result.state, { respondedAt: new Date() });
    const saved = await this.interviewRepository.save(interview);
    // Confirmed one of the HR's alternative times
    if (moved) await this.syncMeet(saved);
    const entry = await this.pipelineService.findOwned(saved.hrUserId, saved.entryId).catch(() => null);
    const type = ANSWER_EVENT[saved.status];
    if (entry && type) {
      await this.pipelineService.recordEvent(entry, { type, interviewAt: saved.startsAt, note: saved.candidateNote });
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

  private async candidate(cvId: number): Promise<{ name: string; email: string | null; role: string }> {
    const cv = await this.cvRepository.findOne({ where: { id: cvId } });
    if (!cv) return { name: '', email: null, role: '' };
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
      this.candidate(interview.cvId),
      this.userRepository.findOne({ where: { id: interview.hrUserId }, select: ['id', 'firstName', 'lastName', 'email', 'companyName'] }),
      interview.vacancyId ? this.vacancyRepository.findOne({ where: { id: interview.vacancyId } }) : null,
    ]);
    return {
      id: interview.id,
      candidateName: candidate.name,
      candidateEmail: candidate.email,
      position: vacancy?.title || candidate.role || 'გასაუბრება',
      company: hr?.companyName ?? '',
      hrName: hr ? `${hr.firstName} ${hr.lastName}`.trim() : '',
      hrEmail: hr?.email ?? '',
      startsAt: interview.startsAt,
      durationMin: interview.durationMin,
      format: interview.format,
      location: interview.location,
      message: interview.message,
      alternatives: interview.alternatives,
      proposedTimes: interview.proposedTimes,
      candidateNote: interview.candidateNote,
      link: interviewLink(interview.id, interview.linkNonce),
      sequence: Math.floor((interview.updatedAt ?? new Date()).getTime() / 1000),
    };
  }

  private toView(iv: HrInterview): InterviewView {
    return {
      id: iv.id,
      entryId: iv.entryId,
      cvId: iv.cvId,
      vacancyId: iv.vacancyId,
      startsAt: iv.startsAt,
      durationMin: iv.durationMin,
      format: iv.format,
      location: iv.location,
      message: iv.message,
      alternatives: iv.alternatives,
      status: iv.status,
      candidateNote: iv.candidateNote,
      proposedTimes: iv.proposedTimes,
      sentTo: iv.sentTo,
      respondedAt: iv.respondedAt,
      createdAt: iv.createdAt,
      googleMeet: !!iv.googleEventId,
      link: interviewLink(iv.id, iv.linkNonce),
    };
  }
}

