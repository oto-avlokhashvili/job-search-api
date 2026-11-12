import { cleanAddress } from 'src/job/apply-email';

/**
 * The candidate's own contacts read from their CV's text: no AI, so it's instant and free.
 * Each field is null when the CV doesn't show it clearly; the candidate can correct what's found.
 */
export interface CvContacts {
  fullName: string | null;
  email: string | null;
  phoneNumber: string | null;
}

// Lines that are headings or labels, never the candidate's name
const NOT_A_NAME =
  /\b(cv|resume|résumé|curriculum|vitae|profile|summary|contacts?|experience|education|skills|objective|about|personal|information|address|portfolio|references?)\b|რეზიუმე|ავტობიოგრაფია|პროფილი|კონტაქტ|გამოცდილება|განათლება|უნარები|მისამართი|ინფორმაცია|შესახებ|პირადი/i;

// Job titles: often the line right after the name, and two words long like a name
const JOB_TITLE =
  /\b(engineer|developer|manager|specialist|designer|accountant|analyst|assistant|consultant|intern|senior|junior|lead|officer|director|administrator|operator|coordinator|representative|agent|architect|scientist|teacher|lawyer|doctor|nurse|driver|cashier|sales|marketing|support|head|chief|executive|student|programmer|tester|qa|hr|recruiter|economist|auditor|translator)\b|მენეჯერ|სპეციალისტ|ინჟინერ|დეველოპერ|ბუღალტერ|ოპერატორ|ასისტენტ|კონსულტანტ|დიზაინერ|ანალიტიკოს|ადმინისტრატორ|კოორდინატორ|წარმომადგენელ|მასწავლებელ|იურისტ|ექიმ|ექთან|მძღოლ|მოლარე|გაყიდვ|სტუდენტ|დირექტორ|ხელმძღვანელ|ეკონომისტ|აუდიტორ|თარჯიმან|პროგრამისტ/i;

// A name word: Georgian or Latin letters, may be hyphenated ("Anna-Maria", "O'Neil")
const NAME_WORD = /^(?:[ა-ჿ]{2,}(?:-[ა-ჿ]{2,})?|[A-Za-zÀ-ž][A-Za-zÀ-ž'’.]*(?:-[A-Za-zÀ-ž][A-Za-zÀ-ž'’]*)?)$/;

// "Name: Giorgi Beridze" / "სახელი, გვარი: ..."
const NAME_LABEL = /^(?:full\s*name|name|სახელი(?:\s*(?:,|და)?\s*გვარი)?)\s*[:\-–]\s*(.+)$/i;

const EMAIL = /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

// Georgian mobile: 5 and 8 more digits, grouped any way ("599 12 34 56", "599 123 456", "(599) 12-34-56"),
// optionally after +995 / 995
const GEORGIAN_MOBILE = /(?<![\d+])(?:\+?\s*995[\s.\-]*)?\(?5(?:[\s.\-]?\d){2}\)?(?:[\s.\-]?\d){6}(?!\d)/;
// Any other international number: +, country code, 8 to 14 more digits
const INTERNATIONAL = /\+\d{1,3}[\s.\-]*\(?\d{1,4}\)?(?:[\s.\-]*\d{2,4}){2,4}(?!\d)/;

const titleCase = (word: string) =>
  /^[A-Z'’.-]+$/.test(word) && word.length > 1 ? word.charAt(0) + word.slice(1).toLowerCase().replace(/-(\w)/g, (_, c) => `-${c.toUpperCase()}`) : word;

/** "GIORGI BERIDZE" → "Giorgi Beridze"; null when the line doesn't look like a person's name. */
export function asName(line: string): string | null {
  const clean = line.replace(/[|•·,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length < 4 || clean.length > 60 || NOT_A_NAME.test(clean) || JOB_TITLE.test(clean)) return null;
  const words = clean.split(' ');
  if (words.length < 2 || words.length > 4 || !words.every((w) => NAME_WORD.test(w))) return null;
  // Letter-spaced headings ("G I O R G I") and initials-only lines
  if (words.filter((w) => w.replace(/[.'’-]/g, '').length >= 2).length < 2) return null;
  return words.map(titleCase).join(' ');
}

function findName(lines: string[]): string | null {
  for (const line of lines) {
    const labelled = line.match(NAME_LABEL);
    if (labelled) {
      const name = asName(labelled[1]);
      if (name) return name;
    }
  }
  // The name is nearly always at the top
  for (const line of lines.slice(0, 12)) {
    const name = asName(line);
    if (name) return name;
  }
  return null;
}

export function findPhone(text: string): string | null {
  const georgian = text.match(GEORGIAN_MOBILE);
  if (georgian) return georgian[0].replace(/\D/g, '').slice(-9);
  const international = text.match(INTERNATIONAL);
  if (international) {
    const digits = international[0].replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 15) return `+${digits}`;
  }
  return null;
}

function findEmail(text: string): string | null {
  for (const match of text.matchAll(EMAIL)) {
    const address = cleanAddress(match[0]);
    if (address) return address;
  }
  return null;
}

export function extractCvContacts(text: string | null | undefined): CvContacts {
  if (!text) return { fullName: null, email: null, phoneNumber: null };
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    // pdf2json page separators
    .filter((l) => l && !/^-+Page \(\d+\) Break-+$/.test(l));
  return { fullName: findName(lines), email: findEmail(text), phoneNumber: findPhone(text) };
}
