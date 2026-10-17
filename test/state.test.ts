import { describe, expect, it } from 'vitest';
import { StateStore } from '../src/state';
import { FakeKV } from './helpers/fake-kv';

describe('StateStore', () => {
  it('stores and reads cursors per folder', async () => {
    const kv = new FakeKV();
    const store = new StateStore(kv as unknown as KVNamespace);

    expect(await store.getCursor('a@example.com', 'INBOX')).toBeNull();
    await store.setCursor('a@example.com', 'INBOX', { uid: 12, uidValidity: 99 });
    expect(await store.getCursor('a@example.com', 'INBOX')).toEqual({
      uid: 12,
      uidValidity: 99,
    });
    expect(await store.getCursor('a@example.com', 'Junk')).toBeNull();
  });

  it('tracks login notifications and duplicates', async () => {
    const kv = new FakeKV();
    const store = new StateStore(kv as unknown as KVNamespace);

    expect(await store.isLoginNotified('a@example.com')).toBe(false);
    await store.markLoginNotified('a@example.com');
    expect(await store.isLoginNotified('a@example.com')).toBe(true);

    expect(await store.isDuplicate('a@example.com', '<one@example.com>')).toBe(false);
    await store.markSeen('a@example.com', '<one@example.com>');
    expect(await store.isDuplicate('a@example.com', '<one@example.com>')).toBe(true);
    expect(await store.isDuplicate('a@example.com', undefined)).toBe(false);
  });

  it('stores account status', async () => {
    const kv = new FakeKV();
    const store = new StateStore(kv as unknown as KVNamespace);

    expect(await store.getStatus('a@example.com')).toBeNull();
    await store.setStatus('a@example.com', {
      email: 'a@example.com',
      lastRunAt: '2026-10-17T00:00:00.000Z',
      folders: { INBOX: { uid: 5, uidValidity: 1 } },
    });
    const status = await store.getStatus('a@example.com');
    expect(status?.email).toBe('a@example.com');
    expect(status?.folders.INBOX).toEqual({ uid: 5, uidValidity: 1 });
  });
});
