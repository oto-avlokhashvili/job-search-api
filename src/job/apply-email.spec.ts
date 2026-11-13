import { cleanAddress, extractApplyEmail } from './apply-email';

describe('cleanAddress', () => {
  it.each([
    ['hr@ziraatbank.geDeadline', 'hr@ziraatbank.ge'],
    ['careers@elehear.comPlease', 'careers@elehear.com'],
    ['Hiring@lb.ge.Subject', 'hiring@lb.ge'],
    ['hr@mail.com.ge', 'hr@mail.com.ge'],
    ['hr.tbilisi@marriott.com', 'hr.tbilisi@marriott.com'],
    ['mariam.bostashvili@cafeter.io', 'mariam.bostashvili@cafeter.io'],
    ['hr@arttteo.co', 'hr@arttteo.co'],
    ['jobs@company.careers', 'jobs@company.careers'],
    // An unknown top-level domain is kept when it's the last part
    ['team@startup.museum', 'team@startup.museum'],
    ['hr@company.ge.Subject-ში', 'hr@company.ge'],
    ['logo@2x.png', null],
  ])('%s → %s', (raw, expected) => {
    expect(cleanAddress(raw)).toBe(expected);
  });
});

describe('extractApplyEmail', () => {
  // Real descriptions from the scraped vacancies
  it.each([
    ['გადმოაგზვანეთ თქვენი CV ელექტრონულ მისამართზე: hr@santaesperanza.geსაგანში მიუთითეთ: წიგნის', 'hr@santaesperanza.ge'],
    ['CV ქართულ ან ინგლისურ ენაზე, შემდეგ ელექტრონულ მისამართზე: Hiring@lb.ge (mailto:Hiring@lb.ge)2026', 'hiring@lb.ge'],
    ['გამოაგზავნოთ CV ელ. ფოსტაზე: agobronidze@alumet.geSubject-ში მიუთითეთ: J', 'agobronidze@alumet.ge'],
    ['Interested candidates should send their CV to hr@kursi.ge\n\nYou can also apply directly', 'hr@kursi.ge'],
    ['დასვენება - კვირა \n\nlashakashibadze@gmail.com', 'lashakashibadze@gmail.com'],
    ['ელ. ფოსტის მისამართზე: vacancy@mdelivery.ge.', 'vacancy@mdelivery.ge'],
  ])('%s', (description, expected) => {
    expect(extractApplyEmail(description)).toBe(expected);
  });

  it('prefers the address asked for the CV over a data-protection or reservations one', () => {
    const description =
      'Reservations: reservation@hotel.ge. პერსონალური მონაცემები: pdpo@hotel.ge. გთხოვთ გამოაგზავნოთ CV: hr@hotel.ge';
    expect(extractApplyEmail(description)).toBe('hr@hotel.ge');
  });

  it('prefers a hiring mailbox when nothing else tells them apart', () => {
    expect(extractApplyEmail('Contact info@gepha.com or jobs@gepha.com')).toBe('jobs@gepha.com');
  });

  it('takes the first address on a tie', () => {
    expect(extractApplyEmail('send CV: l.kurtanidze@cc-express.ge, r.odisharia@casacalda.ge')).toBe('l.kurtanidze@cc-express.ge');
  });

  it("ignores the job sites' own addresses, robots, data-protection mailboxes and file names", () => {
    expect(extractApplyEmail('info@jobs.ge noreply@company.ge logo@2x.png pdp.officer@x.ge personaldata@x.ge')).toBe('');
  });

  it('ignores security, legal and press mailboxes', () => {
    expect(extractApplyEmail('Report issues to security@toloka.ai or press@x.ge')).toBe('');
  });

  it('returns empty without a description or an address', () => {
    expect(extractApplyEmail(null)).toBe('');
    expect(extractApplyEmail('დაგვიკავშირდით: 577 123 456')).toBe('');
  });
});
