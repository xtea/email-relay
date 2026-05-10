import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { AUTH, mockEnv as mockFullEnv } from './helpers';

function mockEnv(token = 'test-token') {
  return mockFullEnv({ token }).env;
}

describe('CORS', () => {
  it('OPTIONS preflight returns 204 with allow-* headers and no auth required', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://example.com/inbox/anyone@example.com', {
        method: 'OPTIONS',
        // Note: no Authorization header — preflights don't carry one.
        headers: {
          origin: 'http://localhost:5174',
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization, content-type',
        },
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(res.headers.get('access-control-allow-methods')).toContain('DELETE');
    const allowHeaders = res.headers.get('access-control-allow-headers') ?? '';
    expect(allowHeaders.toLowerCase()).toContain('authorization');
    expect(allowHeaders.toLowerCase()).toContain('content-type');
  });

  it('authenticated responses include CORS headers', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://example.com/inbox/nobody@example.com', { headers: AUTH }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('401 unauthorized still includes CORS headers (so the browser surfaces the body)', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://example.com/inbox/nobody@example.com'),
      env,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('healthz includes CORS headers', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://example.com/healthz'),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
