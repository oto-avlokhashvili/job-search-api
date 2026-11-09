import { cleanJobTitle, isGeorgianLinkedinJob } from './listing-quality';

describe('cleanJobTitle', () => {
  it.each([
    ['Medical Billing and Insurance Coding Instructor (65895)', 'Medical Billing and Insurance Coding Instructor'],
    ['HVAC Instructor (65897)', 'HVAC Instructor'],
    ['Sales Manager [ID: 123456]', 'Sales Manager'],
    ['Accountant #45678', 'Accountant'],
    ['Data Analyst (Req 98765) - Tbilisi', 'Data Analyst - Tbilisi'],
  ])('%s → %s', (input, expected) => {
    expect(cleanJobTitle(input)).toBe(expected);
  });

  it.each([
    'გაყიდვების მენეჯერი',
    'Operations Supervisor - 3rd Shift',
    'Content Editor & Writer for B2B SaaS Blog (AI-assisted)',
    'ბუღალტერი (2026 წლის სეზონი)',
    'Junior Developer (2+ years)',
  ])('leaves "%s" alone', (title) => {
    expect(cleanJobTitle(title)).toBe(title);
  });
});

describe('isGeorgianLinkedinJob', () => {
  // Real rows from the LinkedIn import, Nov 2026
  it.each([
    { vacancy: 'HVAC Instructor (65897)', company: 'UEI College', location: 'Georgia' },
    { vacancy: 'Part-Time Cook with Benefits', company: 'Acadia Healthcare', location: 'Georgia' },
    { vacancy: 'iSolved Payroll Specialist - GA - On site', company: 'Vensure Employer Solutions', location: 'Georgia' },
    { vacancy: 'Registered Nurse', company: 'Some Hospital', location: 'Atlanta, GA' },
    { vacancy: 'Analyst', company: 'Acme', location: 'Georgia, United States' },
    { vacancy: 'Analyst', company: 'Acme', location: 'Savannah, Georgia' },
    { vacancy: 'Instructor', company: 'UEI College', location: 'Tbilisi, Georgia' }, // known US employer
    { vacancy: 'Frontend Developer', company: 'HiJob.work', location: 'Georgia' }, // bare "Georgia"
    { vacancy: 'იურისტის ასისტენტი', company: 'TBC', location: 'Georgia' }, // bare "Georgia", even in Georgian
  ])('rejects $company / $location', (job) => {
    expect(isGeorgianLinkedinJob(job)).toBe(false);
  });

  it.each([
    { vacancy: 'Startup Manager', company: 'NextVision', location: 'Tbilisi, Georgia' },
    { vacancy: 'Kıdemli Mimar', company: 'Orbi Group', location: 'Batumi, Georgia' },
    { vacancy: 'Engineer', company: 'Acme', location: 'Kutaisi, Imereti, Georgia' },
    { vacancy: 'Engineer', company: 'Acme', location: 'თბილისი' },
  ])('accepts $company / $location', (job) => {
    expect(isGeorgianLinkedinJob(job)).toBe(true);
  });
});

