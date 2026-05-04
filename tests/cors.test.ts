import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';

function mockEnv(token = 'test-token'): Env {
  const store = new Map<string, { value: string; metadata?: unknown }>();
  const kv = {
    get: async (key: string) => store.get(key)?.value ?? null,
    put: async (
      key: string,
      value: string,
      opts?: { metadata?: unknown },
    ) => {
      store.set(key, { value, metadata: opts?.metadata });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async ({ prefix = '' }: { prefix?: string } = {}) => {
      const keys = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([name, { metadata }]) => ({ name, metadata }));
      return { keys, list_complete: true, cursor: '' };
    },
    getWithMetadata: async () => ({ value: null, metadata: null }),
  } as unknown as KVNamespace;
  return { INBOX: kv, INBOX_TOKEN: token };
}

const AUTH = { authorization: 'Bearer test-token' };

describe('CORS', () => {
  it('OPTIONS preflight returns 204 with allow-* headers and no auth required', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://example.com/accounts', {
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
      new Request('http://example.com/accounts', { headers: AUTH }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('401 unauthorized still includes CORS headers (so the browser surfaces the body)', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://example.com/accounts'),
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

  it('OPTIONS to /warm/triggers also returns 204 (preflight for POST)', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://example.com/warm/triggers', { method: 'OPTIONS' }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
