import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateChargeDto } from './create-charge.dto';
import { CreatePaymentDto } from './create-payment.dto';
import { VoidDto } from './void.dto';

const errorProps = async (cls: new () => object, plain: object) =>
  (await validate(plainToInstance(cls, plain))).map((e) => e.property);

const validCharge = {
  category: 'tuition',
  amount: '100.00',
  description: 'Monthly fee',
};
const validPayment = {
  amount: '100.00',
  method: 'cash',
  reference: 'REF-1',
  receivedAt: '2026-10-11',
};

describe('finance DTO text fields', () => {
  it('VoidDto rejects whitespace-only reason', async () => {
    expect(await errorProps(VoidDto, { reason: '   ' })).toContain('reason');
    expect(await errorProps(VoidDto, { reason: 'typo' })).toEqual([]);
  });

  it('CreateChargeDto rejects whitespace-only description', async () => {
    expect(
      await errorProps(CreateChargeDto, { ...validCharge, description: '   ' }),
    ).toContain('description');
    expect(await errorProps(CreateChargeDto, validCharge)).toEqual([]);
  });

  it('CreatePaymentDto rejects whitespace-only reference', async () => {
    expect(
      await errorProps(CreatePaymentDto, { ...validPayment, reference: '   ' }),
    ).toContain('reference');
    expect(await errorProps(CreatePaymentDto, validPayment)).toEqual([]);
  });
});
