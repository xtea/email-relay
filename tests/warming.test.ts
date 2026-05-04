import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';

function mockEnv(token = 'test-token'): Env {
  const store = new Map<string, { value: string; metadata?: unknown; expirationTtl?: number }>();
  const kv = {
    get: async (key: string) => store.get(key)?.value ?? null,
    put: async (
      key: string,
      value: string,
      opts?: { metadata?: unknown; expirationTtl?: number },
    ) => {
      store.set(key, { value, metadata: opts?.metadata, expirationTtl: opts?.expirationTtl });
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

describe('warming routes', () => {
  it('rejects unauthenticated /warm/triggers', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://e/warm/triggers'),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('POST /warm/triggers creates triggers and GET lists them', async () => {
    const env = mockEnv();
    const post = await worker.fetch(
      new Request('http://e/warm/triggers', {
        method: 'POST',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ usernames: ['Alice', 'Bob'] }),
      }),
      env,
    );
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ created: 2 });

    const list = await worker.fetch(
      new Request('http://e/warm/triggers', { headers: AUTH }),
      env,
    );
    const body = (await list.json()) as { usernames: string[] };
    expect(body.usernames.sort()).toEqual(['alice', 'bob']);
  });

  it('POST /warm/triggers rejects non-array', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://e/warm/triggers', {
        method: 'POST',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ usernames: 'alice' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('POST /warm/triggers tolerates an empty list', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://e/warm/triggers', {
        method: 'POST',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ usernames: [] }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: 0 });
  });

  it('DELETE /warm/triggers/<u> 200 then 404', async () => {
    const env = mockEnv();
    await worker.fetch(
      new Request('http://e/warm/triggers', {
        method: 'POST',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ usernames: ['alice'] }),
      }),
      env,
    );
    const first = await worker.fetch(
      new Request('http://e/warm/triggers/alice', { method: 'DELETE', headers: AUTH }),
      env,
    );
    expect(first.status).toBe(200);
    const second = await worker.fetch(
      new Request('http://e/warm/triggers/alice', { method: 'DELETE', headers: AUTH }),
      env,
    );
    expect(second.status).toBe(404);
  });

  it('POST /warm/runs/<u> stores under the iso-suffixed key', async () => {
    const env = mockEnv();
    const started = '2026-05-04T12:00:00Z';
    const post = await worker.fetch(
      new Request('http://e/warm/runs/alice', {
        method: 'POST',
        headers: { ...AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'succeeded',
          started_at: started,
          finished_at: '2026-05-04T12:08:00Z',
          activities: [],
          upvotes_cast: 2,
        }),
      }),
      env,
    );
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual({ ok: true });

    const list = await worker.fetch(
      new Request('http://e/warm/runs?username=alice&limit=5', { headers: AUTH }),
      env,
    );
    const body = (await list.json()) as { runs: { username: string; status: string }[] };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].username).toBe('alice');
    expect(body.runs[0].status).toBe('succeeded');
  });

  it('GET /warm/runs returns newest-first across users when username omitted', async () => {
    const env = mockEnv();
    const stamps = [
      ['alice', '2026-05-04T10:00:00Z'],
      ['bob', '2026-05-04T11:00:00Z'],
      ['alice', '2026-05-04T12:00:00Z'],
    ];
    for (const [u, t] of stamps) {
      await worker.fetch(
        new Request(`http://e/warm/runs/${u}`, {
          method: 'POST',
          headers: { ...AUTH, 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'succeeded', started_at: t }),
        }),
        env,
      );
    }
    const res = await worker.fetch(
      new Request('http://e/warm/runs?limit=5', { headers: AUTH }),
      env,
    );
    const body = (await res.json()) as { runs: { username: string; started_at: string }[] };
    // Newest first
    expect(body.runs.map((r) => r.started_at)).toEqual([
      '2026-05-04T12:00:00Z',
      '2026-05-04T11:00:00Z',
      '2026-05-04T10:00:00Z',
    ]);
  });

  it('GET /warm/runs?limit=… caps the response', async () => {
    const env = mockEnv();
    for (let i = 0; i < 5; i++) {
      await worker.fetch(
        new Request('http://e/warm/runs/alice', {
          method: 'POST',
          headers: { ...AUTH, 'content-type': 'application/json' },
          body: JSON.stringify({ status: 'succeeded', started_at: `2026-05-04T0${i}:00:00Z` }),
        }),
        env,
      );
    }
    const res = await worker.fetch(
      new Request('http://e/warm/runs?username=alice&limit=2', { headers: AUTH }),
      env,
    );
    const body = (await res.json()) as { runs: unknown[] };
    expect(body.runs).toHaveLength(2);
  });

  it('rejects unsupported method on /warm/runs', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://e/warm/runs', { method: 'PUT', headers: AUTH }),
      env,
    );
    expect(res.status).toBe(405);
  });

  it('returns 404 for unknown /warm/* path', async () => {
    const env = mockEnv();
    const res = await worker.fetch(
      new Request('http://e/warm/whoknows', { headers: AUTH }),
      env,
    );
    expect(res.status).toBe(404);
  });
});
