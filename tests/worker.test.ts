import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { mockEnv as mockFullEnv } from './helpers';

function mockEnv(token = 'test-token') {
  return mockFullEnv({ token }).env;
}

describe('email-relay fetch handler', () => {
  it('GET /healthz returns ok without auth', async () => {
    const res = await worker.fetch(new Request('http://example.com/healthz'), mockEnv());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('rejects missing bearer token', async () => {
    const res = await worker.fetch(
      new Request('http://example.com/inbox/foo@example.com'),
      mockEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('rejects wrong bearer token', async () => {
    const res = await worker.fetch(
      new Request('http://example.com/inbox/foo@example.com', {
        headers: { authorization: 'Bearer wrong' },
      }),
      mockEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('returns empty object when no mail received', async () => {
    const res = await worker.fetch(
      new Request('http://example.com/inbox/nobody@example.com', {
        headers: { authorization: 'Bearer test-token' },
      }),
      mockEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('roundtrips a stored record', async () => {
    const env = mockEnv('secret');
    const record = {
      from: 'noreply@reddit.com',
      to: 'rn-test@example.com',
      subject: 'Verify your email',
      source: 'reddit',
      received_at: 1700000000000,
      artifacts: { link: 'https://www.reddit.com/verification/xyz' },
    };
    await env.INBOX.put('reddit:rn-test@example.com', JSON.stringify(record));

    const res = await worker.fetch(
      new Request('http://example.com/inbox/rn-test@example.com?source=reddit', {
        headers: { authorization: 'Bearer secret' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(record);
  });

  it('DELETE clears the key', async () => {
    const env = mockEnv();
    await env.INBOX.put('reddit:foo@example.com', JSON.stringify({ anything: true }));
    const del = await worker.fetch(
      new Request('http://example.com/inbox/foo@example.com?source=reddit', {
        method: 'DELETE',
        headers: { authorization: 'Bearer test-token' },
      }),
      env,
    );
    expect(del.status).toBe(200);
    const get = await worker.fetch(
      new Request('http://example.com/inbox/foo@example.com?source=reddit', {
        headers: { authorization: 'Bearer test-token' },
      }),
      env,
    );
    expect(await get.json()).toEqual({});
  });
});
