/**
 * Account credentials store — backs a persistent KV section under
 * the `accounts:` key prefix. Separate concern from the transient
 * inbox store (1h TTL), but shares the same KV namespace for operational
 * simplicity. Credentials have no TTL.
 *
 * Routes (all Bearer-token authenticated):
 *   PUT    /accounts/<username>        body: any JSON → stored as-is
 *   GET    /accounts/<username>        → stored body, or {} if missing
 *   GET    /accounts                   → { usernames: [...], emails: [...] }
 *   DELETE /accounts/<username>        → { deleted: true }
 */
import type { KVNamespace } from '@cloudflare/workers-types';

export const ACCOUNT_KEY_PREFIX = 'accounts:';

export function accountKey(username: string): string {
  return `${ACCOUNT_KEY_PREFIX}${username.toLowerCase()}`;
}

export async function handleAccounts(
  req: Request,
  kv: KVNamespace,
  pathname: string,
): Promise<Response> {
  // /accounts/<username>
  const match = pathname.match(/^\/accounts\/([^/]+)$/);
  if (match) {
    const username = decodeURIComponent(match[1]);
    const key = accountKey(username);

    if (req.method === 'GET') {
      const raw = await kv.get(key);
      if (!raw) return json({}, 200);
      return new Response(raw, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (req.method === 'PUT') {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: 'body must be valid JSON' }, 400);
      }
      if (typeof body !== 'object' || body === null) {
        return json({ error: 'body must be a JSON object' }, 400);
      }
      const bodyObj = body as Record<string, unknown>;
      const record = {
        ...bodyObj,
        username,
        stored_at: Date.now(),
      };
      // Stash the email in KV metadata so cross-machine clients can list
      // existing emails (for collision-avoidance during identity generation)
      // without paying a GET per key.
      const rawEmail = bodyObj.email;
      const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase() : undefined;
      const metadata = email ? { email } : undefined;
      await kv.put(key, JSON.stringify(record), metadata ? { metadata } : undefined);
      return json({ ok: true }, 200);
    }

    if (req.method === 'DELETE') {
      await kv.delete(key);
      return json({ deleted: true }, 200);
    }

    return json({ error: 'method not allowed' }, 405);
  }

  // /accounts (list)
  if (pathname === '/accounts' && req.method === 'GET') {
    const usernames: string[] = [];
    const emails = new Set<string>();
    let cursor: string | undefined;
    // Paginate through all keys with the prefix.
    for (let i = 0; i < 10; i++) {
      const res: {
        keys: { name: string; metadata?: { email?: string } }[];
        list_complete: boolean;
        cursor?: string;
      } = await kv.list({ prefix: ACCOUNT_KEY_PREFIX, cursor });
      for (const k of res.keys) {
        usernames.push(k.name.slice(ACCOUNT_KEY_PREFIX.length));
        const e = k.metadata?.email;
        if (typeof e === 'string' && e) emails.add(e.toLowerCase());
      }
      if (res.list_complete) break;
      cursor = res.cursor;
    }
    return json({ usernames, emails: [...emails].sort() }, 200);
  }

  return json({ error: 'not found' }, 404);
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
