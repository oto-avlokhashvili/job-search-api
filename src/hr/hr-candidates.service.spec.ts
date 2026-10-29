import { BadRequestException, NotFoundException } from '@nestjs/common';
import { User } from 'src/Entities/user.entity';
import { Cv } from 'src/Entities/cv.entity';
import { HrCvAccessAction } from 'src/Entities/hr-cv-access.entity';
import { PipelineStage } from 'src/Entities/hr-pipeline-entry.entity';
import { HrVacancyStatus } from 'src/Entities/hr-vacancy.entity';
import { HrCandidatesService } from './hr-candidates.service';

const hr = { id: 7, role: 'HR' } as User;

function setup() {
  const cvs: Cv[] = [];
  const cvRepository = {
    create: (v: Partial<Cv>) => ({ ...v }),
    save: jest.fn(async (v: any) => {
      const row = { id: 100 + cvs.length, updatedAt: new Date(), ...v } as Cv;
      cvs.push(row);
      return row;
    }),
    findOne: jest.fn(async ({ where }) => cvs.find((c) => c.id === where.id) ?? null),
  };
  const access: { hrUserId: number; cvId: number; action: HrCvAccessAction }[] = [];
  const accessRepository = {
    insert: jest.fn(async (row: any) => access.push(row)),
    find: jest.fn(async ({ where }) => access.filter((a) => a.hrUserId === where.hrUserId)),
    exists: jest.fn(async ({ where }) => access.some((a) => a.hrUserId === where.hrUserId && a.cvId === where.cvId)),
  };
  const entry = (cvId: number, vacancyId: number | null) => ({
    id: 3,
    hrUserId: 7,
    cvId,
    vacancyId,
    stage: PipelineStage.SOURCED,
    rejectionReason: null,
    rating: null,
    tags: [],
    position: null,
    updatedAt: new Date(),
  });
  const pipeline = {
    placeCandidate: jest.fn(async (_hr: number, cvId: number, vacancyId: number | null) => entry(cvId, vacancyId)),
    memberships: jest.fn(async () => new Map()),
    ensureEntry: jest.fn(),
  };
  const vacancies = {
    findOwned: jest.fn(async (_hr: number, id: number) => ({ id, hrUserId: 7, title: 'Angular Developer', status: HrVacancyStatus.OPEN })),
    touch: jest.fn(),
  };
  const service = new HrCandidatesService(
    cvRepository as any,
    { find: jest.fn(async () => []) } as any,
    accessRepository as any,
    {} as any,
    {} as any,
    {} as any,
    pipeline as any,
    vacancies as any,
  );
  return { service, cvs, access, pipeline, vacancies };
}

describe('HrCandidatesService manual candidates', () => {
  it('adds a file-less private record with name and position to the main board', async () => {
    const { service, cvs, access, pipeline } = setup();
    const card = await service.addManual(hr, { firstName: 'Ani', lastName: 'Tsitskishvili', position: 'Graphic Designer' });

    expect(cvs[0]).toMatchObject({ addedByHrId: 7, manualPosition: 'Graphic Designer', fullName: 'Ani Tsitskishvili', storagePath: '', summary: null });
    expect(access).toEqual([{ hrUserId: 7, cvId: 100, action: HrCvAccessAction.ADDED }]);
    expect(pipeline.placeCandidate).toHaveBeenCalledWith(7, 100, null);
    expect(card).toMatchObject({
      manual: true,
      unlocked: true,
      detectedRole: 'Graphic Designer',
      contact: { fullName: 'Ani Tsitskishvili', email: null, phoneNumber: null },
      pipeline: { vacancyId: null },
    });
  });

  it("goes on an open vacancy's board when one is chosen", async () => {
    const { service, pipeline, vacancies } = setup();
    const card = await service.addManual(hr, { firstName: 'Ani', lastName: 'T', position: 'Designer', vacancyId: 4 });
    expect(vacancies.findOwned).toHaveBeenCalledWith(7, 4);
    expect(pipeline.placeCandidate).toHaveBeenCalledWith(7, 100, 4);
    expect(vacancies.touch).toHaveBeenCalledWith(4);
    expect(card.pipeline.vacancyId).toBe(4);

    vacancies.findOwned.mockResolvedValueOnce({ id: 5, hrUserId: 7, title: 'Closed one', status: HrVacancyStatus.CLOSED });
    await expect(service.addManual(hr, { firstName: 'B', lastName: 'C', position: 'D', vacancyId: 5 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("takes the vacancy's title as the position when none is typed; the main board needs one", async () => {
    const { service, cvs } = setup();
    const card = await service.addManual(hr, { firstName: 'Ani', lastName: 'T', vacancyId: 4 });
    expect(cvs[0].manualPosition).toBe('Angular Developer');
    expect(card.detectedRole).toBe('Angular Developer');

    await service.addManual(hr, { firstName: 'Ani', lastName: 'T', position: 'Tech Lead', vacancyId: 4 });
    expect(cvs[1].manualPosition).toBe('Tech Lead');

    await expect(service.addManual(hr, { firstName: 'Ani', lastName: 'T' })).rejects.toThrow('პოზიცია');
    await expect(service.addManual(hr, { firstName: 'Ani', lastName: 'T', position: '  ' })).rejects.toThrow('პოზიცია');
    expect(cvs).toHaveLength(2);
  });

  it("another HR can't open or download someone's hand-added record", async () => {
    const { service } = setup();
    await service.addManual(hr, { firstName: 'Ani', lastName: 'T', position: 'Designer' });
    const other = { id: 8, role: 'HR' } as User;
    await expect(service.unlock(other, 100)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.download(other, 100)).rejects.toBeInstanceOf(NotFoundException);
    // Its own HR has nothing to download either: there is no file
    await expect(service.download(hr, 100)).rejects.toThrow('missing');
  });
});
