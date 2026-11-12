import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QuickApplyService } from './quick-apply.service';
import { QuickApplyDto } from './dto/quick-apply.dto';

const job = {
  id: 7,
  vacancy: 'Sales Specialist',
  company: 'Acme',
  link: 'https://jobs.ge/7',
  description: 'გამოაგზავნეთ CV: hr@acme.ge',
  applyEmail: 'hr@acme.ge',
};
const user = { id: 3, email: 'User@Example.com', firstName: 'Nino', lastName: 'Beridze' } as any;
const file = { originalname: 'cv.pdf', mimetype: 'application/pdf', size: 1000, buffer: Buffer.from('x') } as Express.Multer.File;

function setup(overrides: { job?: any; exists?: boolean; userCv?: any; saveError?: any; cvText?: string } = {}) {
  const applicationRepository = {
    exists: jest.fn().mockResolvedValue(overrides.exists ?? false),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => {
      if (overrides.saveError) throw overrides.saveError;
      return { id: 11, status: 'QUEUED', createdAt: new Date(), sentAt: null, ...v };
    }),
  };
  const jobRepository = { findOne: jest.fn().mockResolvedValue('job' in overrides ? overrides.job : job) };
  const cvRepository = {
    findOne: jest.fn().mockResolvedValue('userCv' in overrides ? overrides.userCv : { id: 5, consentGiven: true, phoneNumber: null }),
    update: jest.fn(),
  };
  const queue = { add: jest.fn() };
  const cvService = {
    uploadCv: jest.fn().mockResolvedValue({ id: 6, consentGiven: true, phoneNumber: null }),
    // The saved row has the name it was given
    storePublicCv: jest.fn(async (data) => ({ cv: { id: 9, phoneNumber: data.phoneNumber ?? null, fullName: data.fullName ?? null }, searchToken: 'tok' })),
  };
  const cvParser = {
    parseCV: jest.fn().mockResolvedValue(overrides.cvText ?? 'Ana Lomidze\nana.l@gmail.com\n+995 577 11 22 33'),
  };
  const limits = { consume: jest.fn() };
  const turnstile = { verify: jest.fn() };
  const service = new QuickApplyService(
    applicationRepository as any,
    jobRepository as any,
    cvRepository as any,
    queue as any,
    cvService as any,
    cvParser as any,
    limits as any,
    turnstile as any,
  );
  return { service, applicationRepository, cvRepository, queue, cvService, cvParser, limits, turnstile };
}

const dto = (v: Partial<QuickApplyDto> = {}) => ({ consent: true, ...v }) as QuickApplyDto;

describe('QuickApplyService.apply', () => {
  it('needs consent', async () => {
    const { service } = setup();
    await expect(service.apply(7, dto({ consent: false }), undefined, user, 'ip')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s for an unknown job', async () => {
    const { service } = setup({ job: null });
    await expect(service.apply(7, dto(), undefined, user, 'ip')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sends the candidate to the source site when the vacancy names no address', async () => {
    const { service, queue } = setup({ job: { ...job, applyEmail: '' } });
    await expect(service.apply(7, dto(), undefined, user, 'ip')).rejects.toMatchObject({
      response: { code: 'NO_APPLY_EMAIL', link: 'https://jobs.ge/7' },
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("works the address out when the job's column isn't filled in yet", async () => {
    const { service, applicationRepository } = setup({ job: { ...job, applyEmail: null } });
    await service.apply(7, dto(), undefined, user, 'ip');
    expect(applicationRepository.save).toHaveBeenCalledWith(expect.objectContaining({ toEmail: 'hr@acme.ge' }));
  });

  it('signed in: sends the stored CV and queues the email', async () => {
    const { service, applicationRepository, queue, limits } = setup();
    const result = await service.apply(7, dto({ phoneNumber: '599 11 22 33' }), undefined, user, 'ip');

    expect(applicationRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 7,
        cvId: 5,
        userId: 3,
        toEmail: 'hr@acme.ge',
        candidateEmail: 'user@example.com',
        candidateName: 'Nino Beridze',
        candidatePhone: '599 11 22 33',
      }),
    );
    expect(queue.add).toHaveBeenCalledWith('send', { applicationId: 11 }, expect.objectContaining({ jobId: 'quick-apply-11' }));
    expect(limits.consume).toHaveBeenCalledTimes(3);
    expect(result.application.id).toBe(11);
  });

  it('signed in without a stored CV asks for one', async () => {
    const { service } = setup({ userCv: null });
    await expect(service.apply(7, dto(), undefined, user, 'ip')).rejects.toMatchObject({ response: { code: 'NO_CV' } });
  });

  it('signed in with a file: it becomes their CV', async () => {
    const { service, cvService, applicationRepository } = setup();
    await service.apply(7, dto(), file, user, 'ip');
    expect(cvService.uploadCv).toHaveBeenCalledWith(3, file, true);
    expect(applicationRepository.save).toHaveBeenCalledWith(expect.objectContaining({ cvId: 6 }));
  });

  it('records consent on a CV stored without it', async () => {
    const { service, cvRepository } = setup({ userCv: { id: 5, consentGiven: false, phoneNumber: null } });
    await service.apply(7, dto(), undefined, user, 'ip');
    expect(cvRepository.update).toHaveBeenCalledWith(5, expect.objectContaining({ consentGiven: true }));
  });

  it('without an account: needs an email and a file, checks the bot test, saves the CV', async () => {
    const { service, cvService, turnstile } = setup();
    await expect(service.apply(7, dto(), file, null, 'ip')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.apply(7, dto({ email: 'a@b.ge' }), undefined, null, 'ip')).rejects.toBeInstanceOf(BadRequestException);

    const result = await service.apply(7, dto({ email: ' A@B.ge ', fullName: 'A B', phoneNumber: '599000000', turnstileToken: 't' }), file, null, 'ip');
    expect(turnstile.verify).toHaveBeenCalledWith('t', 'ip');
    expect(cvService.storePublicCv).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.ge', fullName: 'A B', phoneNumber: '599000000', consent: true }),
      file,
      'ip',
    );
    expect(result.searchToken).toBe('tok');
    expect(result.application).toMatchObject({ jobId: 7, toEmail: 'hr@acme.ge' });
  });

  it('without an account: reads the name and phone from the CV when they are left out', async () => {
    const { service, cvService, applicationRepository } = setup();
    await service.apply(7, dto({ email: 'a@b.ge' }), file, null, 'ip');
    expect(cvService.storePublicCv).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'Ana Lomidze', phoneNumber: '577112233' }),
      file,
      'ip',
    );
    expect(applicationRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ candidateName: 'Ana Lomidze', candidatePhone: '577112233', candidateEmail: 'a@b.ge' }),
    );
  });

  it("falls back to the email's mailbox name when the CV shows no name", async () => {
    const { service, applicationRepository } = setup({ cvText: 'Experience\n2019-2023' });
    await service.apply(7, dto({ email: 'nino.k@b.ge' }), file, null, 'ip');
    expect(applicationRepository.save).toHaveBeenCalledWith(expect.objectContaining({ candidateName: 'nino.k', candidatePhone: null }));
  });

  it('still sends when the CV cannot be read', async () => {
    const { service, cvParser, queue } = setup();
    cvParser.parseCV.mockRejectedValue(new Error('scanned PDF'));
    await service.apply(7, dto({ email: 'a@b.ge' }), file, null, 'ip');
    expect(queue.add).toHaveBeenCalled();
  });

  it('signed in with a new file and no phone: takes the phone from the CV', async () => {
    const { service, cvRepository } = setup();
    await service.apply(7, dto(), file, user, 'ip');
    expect(cvRepository.update).toHaveBeenCalledWith(6, expect.objectContaining({ phoneNumber: '577112233' }));
  });

  it('preview: returns what the CV shows, storing nothing', async () => {
    const { service, cvService } = setup();
    await expect(service.preview(file)).resolves.toEqual({ fullName: 'Ana Lomidze', email: 'ana.l@gmail.com', phoneNumber: '577112233' });
    await expect(service.preview(undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(cvService.storePublicCv).not.toHaveBeenCalled();
  });

  it('refuses a second application to the same vacancy before storing anything', async () => {
    const { service, cvService, limits } = setup({ exists: true });
    await expect(service.apply(7, dto({ email: 'a@b.ge', fullName: 'A B' }), file, null, 'ip')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(cvService.storePublicCv).not.toHaveBeenCalled();
    expect(limits.consume).not.toHaveBeenCalled();
  });

  it('turns a race on the unique index into "already applied"', async () => {
    const { service, queue } = setup({ saveError: { code: '23505' } });
    await expect(service.apply(7, dto(), undefined, user, 'ip')).rejects.toBeInstanceOf(ConflictException);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
