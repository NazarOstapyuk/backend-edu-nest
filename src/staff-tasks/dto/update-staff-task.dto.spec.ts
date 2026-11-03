import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateStaffTaskDto } from './update-staff-task.dto';

const errorProps = async (plain: object) =>
  (await validate(plainToInstance(UpdateStaffTaskDto, plain))).map(
    (e) => e.property,
  );

describe('UpdateStaffTaskDto', () => {
  it('accepts an empty body and omitted assignees', async () => {
    expect(await errorProps({})).toEqual([]);
  });

  it('rejects null assignees', async () => {
    expect(await errorProps({ assigneeIds: null })).toEqual(['assigneeIds']);
  });

  it('lets null title, date, time and description reach the service', async () => {
    expect(
      await errorProps({
        title: null,
        description: null,
        dueDate: null,
        dueTime: null,
      }),
    ).toEqual([]);
  });
});
