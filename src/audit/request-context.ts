import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestStore {
  requestId: string;
  responseId: string | null;
}

const storage = new AsyncLocalStorage<RequestStore>();

export const runWithRequest = <T>(requestId: string, fn: () => T): T =>
  storage.run({ requestId, responseId: null }, fn);

export const currentRequestId = (): string | null =>
  storage.getStore()?.requestId ?? null;

export const currentResponseId = (): string | null =>
  storage.getStore()?.responseId ?? null;

export const setResponseId = (id: string): void => {
  const store = storage.getStore();
  if (store) store.responseId = id;
};

export const responseIdReader = (): (() => string | null) => {
  const store = storage.getStore();
  return () => store?.responseId ?? null;
};
