import { asName, extractCvContacts, findPhone } from './cv-contacts';

describe('extractCvContacts', () => {
  it('reads a typical Georgian CV header', () => {
    const text = 'გიორგი ბერიძე\nგაყიდვების მენეჯერი\nტელ: 599 12 34 56\nელ-ფოსტა: giorgi.beridze@gmail.com\nპროფილი';
    expect(extractCvContacts(text)).toEqual({
      fullName: 'გიორგი ბერიძე',
      email: 'giorgi.beridze@gmail.com',
      phoneNumber: '599123456',
    });
  });

  it('reads an English CV with the name in capitals and a +995 number', () => {
    const text = 'CURRICULUM VITAE\nNINO KAPANADZE\nSoftware Engineer\n+995 (555) 11-22-33 | nino@example.ge\nEXPERIENCE';
    expect(extractCvContacts(text)).toEqual({ fullName: 'Nino Kapanadze', email: 'nino@example.ge', phoneNumber: '555112233' });
  });

  it('takes a labelled name', () => {
    expect(extractCvContacts('Personal information\nName: Ana Maria Lomidze\nPhone 577001122').fullName).toBe('Ana Maria Lomidze');
    expect(extractCvContacts('სახელი, გვარი: ლაშა ხუციშვილი').fullName).toBe('ლაშა ხუციშვილი');
  });

  it('skips pdf2json page breaks and headings before the name', () => {
    const text = '----------------Page (0) Break----------------\nRESUME\nLevan Gelashvili\nlevan.g@mail.ru';
    expect(extractCvContacts(text).fullName).toBe('Levan Gelashvili');
  });

  it('returns nulls for what the CV does not show', () => {
    expect(extractCvContacts('Experience\n2019-2023 Bank of Georgia')).toEqual({ fullName: null, email: null, phoneNumber: null });
    expect(extractCvContacts('')).toEqual({ fullName: null, email: null, phoneNumber: null });
  });
});

describe('asName', () => {
  it.each([
    ['Senior Developer', null],
    ['G I O R G I', null],
    ['Tbilisi, Georgia 0179', null],
    ["Mary-Jane O'Neil", "Mary-Jane O'Neil"],
    ['MARY-JANE WATSON', 'Mary-Jane Watson'],
  ])('%s → %s', (line, expected) => {
    expect(asName(line)).toBe(expected);
  });
});

describe('findPhone', () => {
  it.each([
    ['tel: 995 599 123 456', '599123456'],
    ['(599) 12-34-56', '599123456'],
    ['599 123 456', '599123456'],
    ['mob.: 5 9 9 1 2 3 4 5 6', '599123456'],
    ['born 1995 5 55 55', null],
    ['+49 151 2345 6789', '+4915123456789'],
    ['2018 - 2021', null],
  ])('%s → %s', (text, expected) => {
    expect(findPhone(text)).toBe(expected);
  });
});
