import {
  currentRequestId,
  currentResponseId,
  runWithRequest,
  setResponseId,
} from './request-context';

describe('request context', () => {
  it('is empty outside a request', () => {
    expect(currentRequestId()).toBeNull();
    expect(currentResponseId()).toBeNull();
    setResponseId('ignored');
    expect(currentResponseId()).toBeNull();
  });

  it('keeps the id across awaits and stores the response id', async () => {
    await runWithRequest('r1', async () => {
      await Promise.resolve();
      expect(currentRequestId()).toBe('r1');
      setResponseId('e1');
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(currentResponseId()).toBe('e1');
    });
    expect(currentRequestId()).toBeNull();
  });
});
