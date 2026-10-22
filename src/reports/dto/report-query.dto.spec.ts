import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReportQueryDto } from './report-query.dto';

describe('ReportQueryDto', () => {
  it('keeps institutionId under whitelist validation', async () => {
    const id = '0b7e6a52-6f4d-4c1b-8d3e-2f6c1a9b7e10';
    const dto = plainToInstance(ReportQueryDto, { institutionId: id });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toEqual([]);
    expect(dto.institutionId).toBe(id);
  });
  it('rejects a non-uuid institutionId', async () => {
    const dto = plainToInstance(ReportQueryDto, { institutionId: 'x' });
    expect(await validate(dto, { whitelist: true })).toHaveLength(1);
  });
});
