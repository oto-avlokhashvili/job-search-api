/** The email that carries a quick-apply CV to the employer. Pure, so it can be tested without Brevo. */

export interface QuickApplyEmailInput {
  jobTitle: string;
  company: string;
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string | null;
  /** The employer address, as published in the vacancy */
  toEmail: string;
  siteUrl: string;
}

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const oneLine = (s: string, max: number) => {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** The blue of the Job Up logo */
const BRAND = '#0e6094';

/** Mail clients can only load the logo from a public https site, so a local siteUrl falls back to production. */
export function logoUrl(siteUrl: string): string {
  try {
    const url = new URL(siteUrl);
    if (url.protocol === 'https:' && url.hostname !== 'localhost') return `${url.origin}/icons/logo-light.png`;
  } catch {
    // fall through
  }
  return 'https://jobup.ge/icons/logo-light.png';
}

/** "CV - Nino Beridze.pdf": the employer sees whose CV it is, not our storage name. */
export function attachmentName(candidateName: string, originalName: string): string {
  const ext = (originalName.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  const name = oneLine(candidateName, 80).replace(/[\\/:*?"<>|]/g, '');
  return `CV - ${name || 'candidate'}.${ext}`;
}

export function buildQuickApplyEmail(input: QuickApplyEmailInput): { subject: string; html: string } {
  const title = oneLine(input.jobTitle, 150);
  const name = oneLine(input.candidateName, 100);
  // Employers often ask for the position in the subject
  const subject = `CV: ${title} — ${name}`;

  const contacts = [
    `<a href="mailto:${esc(input.candidateEmail)}">${esc(input.candidateEmail)}</a>`,
    input.candidatePhone ? esc(input.candidatePhone) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  // Why the employer got this, naming only Job Up (not the job site or anyone else): keeps it from reading as spam
  const company = input.company ? oneLine(input.company, 150) : '';
  const to = esc(input.toEmail);
  const site = esc(input.siteUrl);
  const jobUp = `<a href="${site}" style="color:${BRAND};text-decoration:none;font-weight:bold">Job Up</a>`;

  const footerKa =
    `ეს წერილი მიიღეთ, რადგან მისამართი ${to} მითითებულია ვაკანსიაში „${esc(title)}“. ` +
    `CV გამოგზავნილია ${jobUp}-ის სწრაფი განაცხადით, კანდიდატის თანხმობით. წერილზე პასუხი პირდაპირ კანდიდატს მიუვა.`;
  const footerEn =
    `You received this because ${to} is listed in the vacancy "${esc(title)}". ` +
    `The CV was sent with ${jobUp} quick apply, with the candidate's consent. Replies go directly to the candidate.`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:600px">
  <p>გამარჯობა,</p>
  <p><b>${esc(name)}</b> გიგზავნით CV-ს ვაკანსიაზე <b>„${esc(title)}“</b>${company ? ` (${esc(company)})` : ''}. CV თან ერთვის წერილს.</p>
  <p>კონტაქტი: ${contacts}</p>
  <p>ამ წერილზე პასუხი პირდაპირ კანდიდატს მიუვა.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;background:#f4f7fa;border-radius:10px">
    <tr><td style="padding:18px 20px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;padding-right:10px"><a href="${site}"><img src="${esc(logoUrl(input.siteUrl))}" width="28" height="29" alt="Job Up" style="display:block;border:0"></a></td>
        <td style="vertical-align:middle"><a href="${site}" style="font-size:17px;font-weight:bold;color:${BRAND};text-decoration:none">Job Up</a></td>
      </tr></table>
      <p style="margin:14px 0 0;font-size:12px;line-height:1.55;color:#4b5563">${footerKa}</p>
      <p style="margin:10px 0 0;padding-top:10px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.55;color:#6b7280">${footerEn}</p>
    </td></tr>
  </table>
</div>`;

  return { subject, html };
}
