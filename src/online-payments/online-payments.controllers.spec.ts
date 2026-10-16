import { RawBodyRequest } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  FinanceCategory,
  PermissionArea,
  PermissionLevel,
  Role,
} from '@prisma/client';
import type { Request } from 'express';
import {
  PERMISSION_KEY,
  type RequiredPermission,
} from '../common/decorators/permission.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user.type';
import { OnlinePaymentsService } from './online-payments.service';
import { ParentOnlinePaymentsController } from './parent-online-payments.controller';
import { PublicOnlinePaymentsController } from './public-online-payments.controller';
import { StaffOnlinePaymentsController } from './staff-online-payments.controller';

const user = { id: 'u1' } as AuthenticatedUser;

type ServiceMock = jest.Mocked<
  Pick<
    OnlinePaymentsService,
    | 'config'
    | 'payFromCabinet'
    | 'parentInvoice'
    | 'createLink'
    | 'listRequests'
    | 'cancel'
    | 'publicLink'
    | 'payLink'
    | 'handleWebhook'
    | 'testResult'
  >
>;

const makeService = (): ServiceMock => ({
  config: jest.fn().mockReturnValue({ enabled: false }),
  payFromCabinet: jest.fn().mockResolvedValue('pay'),
  parentInvoice: jest.fn().mockResolvedValue('inv'),
  createLink: jest.fn().mockResolvedValue('link'),
  listRequests: jest.fn().mockResolvedValue('list'),
  cancel: jest.fn().mockResolvedValue('cancel'),
  publicLink: jest.fn().mockResolvedValue('public'),
  payLink: jest.fn().mockResolvedValue('paylink'),
  handleWebhook: jest.fn().mockResolvedValue(undefined),
  testResult: jest.fn().mockResolvedValue('test'),
});

const setup = async () => {
  const service = makeService();
  const module = await Test.createTestingModule({
    controllers: [
      ParentOnlinePaymentsController,
      StaffOnlinePaymentsController,
      PublicOnlinePaymentsController,
    ],
    providers: [{ provide: OnlinePaymentsService, useValue: service }],
  }).compile();
  return {
    service,
    parent: module.get(ParentOnlinePaymentsController),
    staff: module.get(StaffOnlinePaymentsController),
    publicApi: module.get(PublicOnlinePaymentsController),
  };
};

describe('online payment controllers', () => {
  const reflector = new Reflector();

  it('parent routes delegate', async () => {
    const { service, parent: controller } = await setup();
    const dto = { category: FinanceCategory.meals, amount: '10.00' };
    expect(await controller.pay(user, 'c1', dto)).toBe('pay');
    expect(service.payFromCabinet).toHaveBeenCalledWith('u1', 'c1', dto);
    expect(await controller.invoice(user, 'i1')).toBe('inv');
    expect(service.parentInvoice).toHaveBeenCalledWith('u1', 'i1');
  });

  it('staff routes delegate', async () => {
    const { service, staff: controller } = await setup();
    const dto = { category: FinanceCategory.meals, amount: '10.00' };
    expect(await controller.createLink(user, 'c1', dto)).toBe('link');
    expect(service.createLink).toHaveBeenCalledWith(user, 'c1', dto);
    expect(await controller.list(user, 'c1')).toBe('list');
    expect(service.listRequests).toHaveBeenCalledWith(user, 'c1');
    expect(await controller.cancel(user, 'r1')).toBe('cancel');
    expect(service.cancel).toHaveBeenCalledWith(user, 'r1');
  });

  it('public routes delegate', async () => {
    const { service, publicApi: controller } = await setup();
    expect(await controller.link('k')).toBe('public');
    expect(service.publicLink).toHaveBeenCalledWith('k');
    expect(await controller.payLink('k')).toBe('paylink');
    expect(service.payLink).toHaveBeenCalledWith('k');
    expect(await controller.testResult('test_1', { result: 'success' })).toBe(
      'test',
    );
    expect(service.testResult).toHaveBeenCalledWith('test_1', 'success');
    expect(controller.config()).toEqual({ enabled: false });
  });

  it('webhook passes raw body and headers', async () => {
    const { service, publicApi: controller } = await setup();
    const rawBody = Buffer.from('{"a":1}');
    const req = {
      rawBody,
      headers: { 'x-sign': 'abc' },
    } as RawBodyRequest<Request>;
    expect(await controller.webhook('test', req)).toEqual({ ok: true });
    expect(service.handleWebhook).toHaveBeenCalledWith('test', rawBody, {
      'x-sign': 'abc',
    });
  });

  it('webhook without raw body passes an empty buffer', async () => {
    const { service, publicApi: controller } = await setup();
    const req = { headers: {} } as RawBodyRequest<Request>;
    await controller.webhook('test', req);
    expect(service.handleWebhook).toHaveBeenCalledWith(
      'test',
      Buffer.alloc(0),
      {},
    );
  });

  it('staff routes carry permissions', () => {
    const read = (name: keyof StaffOnlinePaymentsController) =>
      reflector.get<RequiredPermission>(
        PERMISSION_KEY,
        StaffOnlinePaymentsController.prototype[name],
      );
    expect(read('createLink')).toEqual({
      area: PermissionArea.finance,
      level: PermissionLevel.edit,
    });
    expect(read('list')).toEqual({
      area: PermissionArea.finance,
      level: PermissionLevel.view,
    });
    expect(read('cancel')).toEqual({
      area: PermissionArea.finance,
      level: PermissionLevel.edit,
    });
  });

  it('parent controller is parent-only, public has no metadata', () => {
    expect(reflector.get(ROLES_KEY, ParentOnlinePaymentsController)).toEqual([
      Role.parent,
    ]);
    expect(
      Reflect.getMetadata('__guards__', PublicOnlinePaymentsController),
    ).toBeUndefined();
    expect(
      reflector.get(ROLES_KEY, PublicOnlinePaymentsController),
    ).toBeUndefined();
    expect(
      reflector.get(PERMISSION_KEY, PublicOnlinePaymentsController),
    ).toBeUndefined();
  });
});
