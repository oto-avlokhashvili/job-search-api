import { InterviewFormat, InterviewStatus } from 'src/Entities/hr-interview.entity';
import { formatDate, formatShort, formatTime, frontendUrl } from './interview';

/** Everything the interview emails show. Free text (names, message, place) is escaped here. */
export interface InterviewMailData {
  id: number;
  candidateName: string;
  position: string;
  company: string;
  hrName: string;
  hrEmail: string;
  startsAt: Date;
  durationMin: number;
  format: InterviewFormat;
  location: string;
  message: string | null;
  alternatives: Date[];
  candidateNote: string | null;
  /** Declined because none of the offered times suits them */
  timeConflict: boolean;
  /** Candidate's answer page */
  link: string;
  /** Changes on every edit, so calendars replace the old event */
  sequence: number;
  /** Invited candidate not on the platform yet: accepting asks for their CV */
  newCandidate?: boolean;
}

export interface MailContent {
  subject: string;
  html: string;
  ics?: string;
}

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const BRAND = '#2563eb';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const endsAt = (d: InterviewMailData) => new Date(d.startsAt.getTime() + d.durationMin * 60000);
const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

// ─── Building blocks (tables + inline styles: what Gmail, Outlook and Apple Mail all render) ───

function layout(opts: { preheader: string; company: string; body: string; footer?: string }): string {
  return `<!doctype html>
<html lang="ka"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>Job Up</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:${FONT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding:0 4px 14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:20px;font-weight:800;color:${BRAND};">Job Up</td>
        <td align="right" style="font-size:13px;font-weight:600;color:#64748b;">${esc(opts.company)}</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;padding:28px 24px;">
      ${opts.body}
    </td></tr>
    <tr><td style="padding:16px 8px;text-align:center;font-size:12px;line-height:1.6;color:#94a3b8;">
      ${opts.footer ?? ''}
      <div>გამოგზავნილია Job Up-ის მეშვეობით · <a href="${frontendUrl()}" style="color:#94a3b8;">jobup.ge</a></div>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const heading = (title: string, sub?: string) => `
  <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;color:#0f172a;">${title}</h1>
  ${sub ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569;">${sub}</p>` : ''}`;

function detailRow(icon: string, label: string, value: string) {
  return `<tr>
    <td width="28" valign="top" style="padding:7px 0;font-size:16px;">${icon}</td>
    <td width="96" valign="top" style="padding:7px 0;font-size:13px;color:#64748b;">${label}</td>
    <td valign="top" style="padding:7px 0;font-size:15px;font-weight:600;color:#0f172a;">${value}</td>
  </tr>`;
}

function details(d: InterviewMailData) {
  const place =
    d.format === InterviewFormat.ONLINE
      ? isUrl(d.location)
        ? `ონლაინ · <a href="${esc(d.location.trim())}" style="color:${BRAND};">შეხვედრის ლინკი</a>`
        : `ონლაინ${d.location ? ` · ${esc(d.location)}` : ''}`
      : esc(d.location) || 'ოფისში';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:8px 16px;margin:0 0 18px;">
    ${detailRow('💼', 'პოზიცია', esc(d.position))}
    ${
      offered(d).length > 1
        ? // Several times on offer: all of them, the candidate picks one
          detailRow('📅', 'ვარიანტები', `${offered(d).map((t) => formatShort(t)).join('<br>')} <span style="font-weight:400;color:#64748b;">(${d.durationMin} წთ)</span>`)
        : `${detailRow('📅', 'თარიღი', formatDate(d.startsAt))}
    ${detailRow('🕑', 'დრო', `${formatTime(d.startsAt)} – ${formatTime(endsAt(d))} <span style="font-weight:400;color:#64748b;">(${d.durationMin} წთ)</span>`)}`
    }
    ${detailRow(d.format === InterviewFormat.ONLINE ? '💻' : '📍', 'ადგილი', place)}
    ${detailRow('👤', 'HR', `${esc(d.hrName)}${d.company ? ` · ${esc(d.company)}` : ''}`)}
  </table>`;
}

const quote = (text: string | null) =>
  text
    ? `<p style="margin:0 0 20px;padding:12px 14px;border-left:3px solid ${BRAND};background:#eff6ff;border-radius:0 8px 8px 0;font-size:14px;line-height:1.6;color:#334155;white-space:pre-line;">${esc(text)}</p>`
    : '';

function button(href: string, label: string, bg: string, color = '#ffffff', border = bg) {
  return `<a href="${href}" target="_blank"
    style="display:inline-block;padding:13px 22px;margin:0 6px 10px 0;border-radius:10px;border:1px solid ${border};
    background:${bg};color:${color};font-size:15px;font-weight:700;text-decoration:none;">${label}</a>`;
}

/** The times on offer: the main one, then the HR's alternatives still ahead */
const offered = (d: InterviewMailData) => [d.startsAt, ...d.alternatives.filter((t) => t.getTime() > Date.now())];

function answerButtons(d: InterviewMailData) {
  const decline = button(`${d.link}?a=decline`, '❌ უარი', '#ffffff', '#dc2626', '#fecaca');
  if (offered(d).length === 1) {
    return `
  <div style="margin:4px 0 6px;">
    ${button(`${d.link}?a=confirm`, '✅ დადასტურება', '#16a34a')}
    ${decline}
  </div>`;
  }
  // Each variant confirms itself (the main time has no slot)
  const slotOf = (t: Date) => (t === d.startsAt ? '' : `&slot=${d.alternatives.indexOf(t)}`);
  return `
  <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#64748b;">აირჩიეთ თქვენთვის მოსახერხებელი დრო:</p>
  <div style="margin:0 0 8px;">${offered(d)
    .map((t) => button(`${d.link}?a=confirm${slotOf(t)}`, `✅ ${formatShort(t)}`, '#f0fdf4', '#15803d', '#bbf7d0'))
    .join('')}</div>
  <div style="margin:0 0 6px;">${decline}</div>`;
}

const calendarNote = `<p style="margin:14px 0 0;font-size:13px;color:#64748b;">📎 თანდართული ფაილით (interview.ics) გასაუბრებას კალენდარში დაამატებთ.</p>`;
const greeting = (name: string) => (name ? `გამარჯობა, ${esc(name.split(/\s+/)[0])} 👋` : 'გამარჯობა 👋');

// ─── Emails to the candidate ───────────────────────────────────

export function inviteEmail(d: InterviewMailData, updated = false): MailContent {
  const title = updated ? 'გასაუბრების დეტალები შეიცვალა' : 'გიწვევთ გასაუბრებაზე';
  return {
    subject: `${updated ? '🔄 შეცვლილი გასაუბრება' : '📅 მოწვევა გასაუბრებაზე'}: ${d.position}${d.company ? ` · ${d.company}` : ''}`,
    html: layout({
      preheader: `${formatDate(d.startsAt)}, ${formatTime(d.startsAt)} · გთხოვთ, დაადასტუროთ`,
      company: d.company,
      body: `
        <p style="margin:0 0 6px;font-size:15px;color:#475569;">${greeting(d.candidateName)}</p>
        ${heading(title, `${esc(d.company || d.hrName)} გიწვევთ გასაუბრებაზე პოზიციაზე <strong>${esc(d.position)}</strong>. გთხოვთ, გვაცნობოთ, მოგიხერხდებათ თუ არა.`)}
        ${details(d)}
        ${quote(d.message)}
        ${
          d.newCandidate
            ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">📄 დადასტურებისას გთხოვთ, მიუთითოთ საკონტაქტო მონაცემები და ატვირთოთ თქვენი CV, რომ ${esc(d.company || d.hrName)} წინასწარ გაეცნოს.</p>`
            : ''
        }
        ${answerButtons(d)}
        ${calendarNote}`,
      footer: `<div style="margin-bottom:6px;">კითხვა გაქვთ? უბრალოდ უპასუხეთ ამ წერილს: პასუხი ${esc(d.hrName)}-ს მიუვა.</div>`,
    }),
    ics: buildIcs(d, InterviewStatus.PENDING),
  };
}

export function confirmedEmail(d: InterviewMailData): MailContent {
  return {
    subject: `✅ გასაუბრება დადასტურებულია: ${formatShort(d.startsAt)}`,
    html: layout({
      preheader: `${formatDate(d.startsAt)}, ${formatTime(d.startsAt)}`,
      company: d.company,
      body: `
        <p style="margin:0 0 6px;font-size:15px;color:#475569;">${greeting(d.candidateName)}</p>
        ${heading('გასაუბრება დადასტურებულია ✅', 'გელოდებით! დეტალები ქვემოთაა.')}
        ${details(d)}
        <p style="margin:0;font-size:14px;color:#475569;">გეგმები შეგეცვალათ? <a href="${d.link}" style="color:${BRAND};font-weight:600;">შეცვალეთ პასუხი</a>.</p>
        ${calendarNote}`,
    }),
    ics: buildIcs(d, InterviewStatus.CONFIRMED),
  };
}

export function cancelledEmail(d: InterviewMailData): MailContent {
  return {
    subject: `გასაუბრება გაუქმდა: ${d.position}`,
    html: layout({
      preheader: `${formatDate(d.startsAt)}, ${formatTime(d.startsAt)} · გაუქმებულია`,
      company: d.company,
      body: `
        <p style="margin:0 0 6px;font-size:15px;color:#475569;">${greeting(d.candidateName)}</p>
        ${heading('გასაუბრება გაუქმდა', `${esc(d.company || d.hrName)}-მა გააუქმა გასაუბრება, რომელიც დაგეგმილი იყო <strong>${formatDate(d.startsAt)}, ${formatTime(d.startsAt)}</strong>-ზე.`)}
        <p style="margin:0;font-size:14px;color:#475569;">კითხვების შემთხვევაში უპასუხეთ ამ წერილს.</p>`,
    }),
    ics: buildIcs(d, InterviewStatus.CANCELLED),
  };
}

export function reminderEmail(d: InterviewMailData, hoursBefore: number): MailContent {
  const when = hoursBefore >= 24 ? 'ხვალ' : 'დაახლოებით 1 საათში';
  return {
    subject: `⏰ შეხსენება: გასაუბრება ${when}, ${formatTime(d.startsAt)}`,
    html: layout({
      preheader: `${d.position} · ${formatTime(d.startsAt)}`,
      company: d.company,
      body: `
        <p style="margin:0 0 6px;font-size:15px;color:#475569;">${greeting(d.candidateName)}</p>
        ${heading(`გასაუბრება ${when}`, 'შეგახსენებთ დაგეგმილ გასაუბრებას.')}
        ${details(d)}
        <p style="margin:0;font-size:14px;color:#475569;">ვერ ახერხებთ? <a href="${d.link}" style="color:${BRAND};font-weight:600;">გვაცნობეთ</a>.</p>`,
    }),
  };
}

// ─── Emails to the HR ──────────────────────────────────────────

const boardLink = () => `${frontendUrl()}/hr/candidates`;

export function hrAnswerEmail(d: InterviewMailData, status: InterviewStatus): MailContent {
  const name = d.candidateName || 'კანდიდატი';
  const confirmed = status === InterviewStatus.CONFIRMED;
  // Declined only over the time: the HR can offer other times
  const timeOnly = !confirmed && d.timeConflict;
  const headline = confirmed
    ? `${esc(name)}-მა დაადასტურა გასაუბრება ✅`
    : timeOnly
      ? `${esc(name)}-ს შემოთავაზებული დრო არ მოერგო 🕑`
      : `${esc(name)}-მა უარი თქვა გასაუბრებაზე`;
  const subjectWord = confirmed ? 'დადასტურდა' : timeOnly ? 'დრო არ მოერგო' : 'უარი';
  return {
    subject: `${subjectWord}: ${name} · ${d.position}`,
    html: layout({
      preheader: `${formatDate(d.startsAt)}, ${formatTime(d.startsAt)}`,
      company: d.company,
      body: `
        ${heading(headline, timeOnly ? 'შესთავაზეთ სხვა დროის ვარიანტები: გასაუბრების შეცვლისას კანდიდატი ახალ მოწვევას მიიღებს.' : undefined)}
        ${details(d)}
        ${quote(d.candidateNote)}
        ${button(boardLink(), timeOnly ? 'სხვა დროის შეთავაზება' : 'კანდიდატის ნახვა', BRAND)}`,
    }),
    ics: status === InterviewStatus.CONFIRMED ? buildIcs(d, InterviewStatus.CONFIRMED) : undefined,
  };
}

export function hrReminderEmail(d: InterviewMailData, hoursBefore: number): MailContent {
  const when = hoursBefore >= 24 ? 'ხვალ' : 'დაახლოებით 1 საათში';
  return {
    subject: `⏰ გასაუბრება ${when}: ${d.candidateName || 'კანდიდატი'} · ${formatTime(d.startsAt)}`,
    html: layout({
      preheader: `${d.position} · ${formatTime(d.startsAt)}`,
      company: d.company,
      body: `${heading(`გასაუბრება ${when}`, `${esc(d.candidateName || 'კანდიდატი')} · ${esc(d.position)}`)}${details(d)}${button(boardLink(), 'კანდიდატის ნახვა', BRAND)}`,
    }),
  };
}

// ─── Calendar file ─────────────────────────────────────────────

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets are folded (RFC 5545); Georgian letters take 3 bytes each. */
function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > 73) {
      out.push(current);
      current = ' ';
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n');
}

export function buildIcs(d: InterviewMailData, status: InterviewStatus): string {
  const cancelled = status === InterviewStatus.CANCELLED;
  const description = [d.message, `პასუხი: ${d.link}`].filter(Boolean).join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Job Up//Interviews//KA',
    'CALSCALE:GREGORIAN',
    // PUBLISH even for a cancellation: CANCEL needs an ORGANIZER; STATUS:CANCELLED updates the same UID
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:interview-${d.id}@jobup.ge`,
    `SEQUENCE:${d.sequence}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(d.startsAt)}`,
    `DTEND:${icsDate(endsAt(d))}`,
    `SUMMARY:${icsText(`გასაუბრება: ${d.position}${d.company ? ` · ${d.company}` : ''}`)}`,
    `LOCATION:${icsText(d.location || (d.format === InterviewFormat.ONLINE ? 'ონლაინ' : ''))}`,
    `DESCRIPTION:${icsText(description)}`,
    `STATUS:${cancelled ? 'CANCELLED' : status === InterviewStatus.CONFIRMED ? 'CONFIRMED' : 'TENTATIVE'}`,
    ...(cancelled
      ? []
      : ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:გასაუბრება', 'TRIGGER:-PT30M', 'END:VALARM']),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
