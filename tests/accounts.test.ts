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
    list: async ({ prefix = '', cursor: _cursor }: { prefix?: string; cursor?: string } = {}) => {
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

describe('accounts routes', () => {
  it('rejects unauthenticated requests', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://example.com/accounts/alice'),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('GET /accounts/<username> returns {} when missing', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://example.com/accounts/alice', { headers: AUTH }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('PUT then GET roundtrips an account record', async () => {
    const env = mockEnv();
    const put = await worker.fetch(
      new Request('http://example.com/accounts/Alice123', {
        method: 'PUT',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'alice.smith@example.com',
          password: 'super-secret',
          created_at: '2026-04-24T12:00:00Z',
        }),
      }),
      env,
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true });

    // GET is case-insensitive on username (we store lowercase)
    const get = await worker.fetch(
      new Request('http://example.com/accounts/alice123', { headers: AUTH }),
      env,
    );
    expect(get.status).toBe(200);
    const got = (await get.json()) as Record<string, unknown>;
    expect(got.email).toBe('alice.smith@example.com');
    expect(got.password).toBe('super-secret');
    expect(got.username).toBe('Alice123'); // server normalises to whatever the PUT path said
    expect(typeof got.stored_at).toBe('number');
  });

  it('PUT with non-JSON body returns 400', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://example.com/accounts/alice', {
        method: 'PUT',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: 'not-json',
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('DELETE clears the stored account', async () => {
    const env = mockEnv();
    await worker.fetch(
      new Request('http://example.com/accounts/bob', {
        method: 'PUT',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'b@example.com' }),
      }),
      env,
    );
    const del = await worker.fetch(
      new Request('http://example.com/accounts/bob', {
        method: 'DELETE',
        headers: AUTH,
      }),
      env,
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ deleted: true });
    const get = await worker.fetch(
      new Request('http://example.com/accounts/bob', { headers: AUTH }),
      env,
    );
    expect(await get.json()).toEqual({});
  });

  it('GET /accounts returns usernames and emails (from KV metadata)', async () => {
    const env = mockEnv();
    for (const u of ['alice', 'bob', 'carol']) {
      await worker.fetch(
        new Request(`http://example.com/accounts/${u}`, {
          method: 'PUT',
          headers: { ...AUTH, 'content-type': 'application/json' },
          body: JSON.stringify({ email: `${u}@example.com` }),
        }),
        env,
      );
    }
    const res = await worker.fetch(
      new Request('http://example.com/accounts', { headers: AUTH }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { usernames: string[]; emails: string[] };
    expect(body.usernames.sort()).toEqual(['alice', 'bob', 'carol']);
    expect(body.emails.sort()).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
    ]);
  });

  it('inbox routes still work alongside accounts routes', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://example.com/inbox/nobody@example.com', { headers: AUTH }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });
});
