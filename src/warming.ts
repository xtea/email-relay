/**
 * Warming-pool coordination routes.
 *
 * Lives alongside `accounts:*` in the same KV namespace, under two key
 * prefixes:
 *
 *   warm-trigger:<username>       TTL 1h  — one-shot "warm this account
 *                                 now" requests written by the dashboard
 *                                 and consumed by the local runner.
 *   warm-run:<username>:<iso>     TTL 30d — historical warming run logs,
 *                                 written by the local runner after each
 *                                 session completes.
 *
 * Routes (all bearer-token authenticated):
 *
 *   POST   /warm/triggers              { usernames: string[] } -> { created: n }
 *   GET    /warm/triggers              -> { usernames: string[] }
 *   DELETE /warm/triggers/<username>   -> 200 { deleted: true } | 404
 *   POST   /warm/runs/<username>       <WarmRun JSON>          -> { ok: true }
 *   GET    /warm/runs?username=&limit= -> { runs: WarmRun[] }   (newest first)
 */
import type { KVNamespace } from '@cloudflare/workers-types';

const TRIGGER_PREFIX = 'warm-trigger:';
const RUN_PREFIX = 'warm-run:';
const TRIGGER_TTL_SECONDS = 3600; // 1 hour
const RUN_TTL_SECONDS = 30 * 24 * 3600; // 30 days
const DEFAULT_RUN_LIMIT = 20;
const MAX_RUN_LIMIT = 200;

export async function handleWarming(
  req: Request,
  kv: KVNamespace,
  pathname: string,
): Promise<Response> {
  // ---- /warm/triggers (collection) ----
  if (pathname === '/warm/triggers') {
    if (req.method === 'POST') return postTriggers(req, kv);
    if (req.method === 'GET') return listTriggers(kv);
    return json({ error: 'method not allowed' }, 405);
  }

  // ---- /warm/triggers/<username> ----
  const triggerMatch = pathname.match(/^\/warm\/triggers\/([^/]+)$/);
  if (triggerMatch) {
    const username = decodeURIComponent(triggerMatch[1]).toLowerCase();
    if (req.method === 'DELETE') {
      const key = `${TRIGGER_PREFIX}${username}`;
      const existing = await kv.get(key);
      if (existing === null) return json({ error: 'not found' }, 404);
      await kv.delete(key);
      return json({ deleted: true }, 200);
    }
    return json({ error: 'method not allowed' }, 405);
  }

  // ---- /warm/runs (collection) ----
  if (pathname === '/warm/runs') {
    if (req.method === 'GET') return listRuns(req, kv);
    return json({ error: 'method not allowed' }, 405);
  }

  // ---- /warm/runs/<username> ----
  const runMatch = pathname.match(/^\/warm\/runs\/([^/]+)$/);
  if (runMatch) {
    const username = decodeURIComponent(runMatch[1]);
    if (req.method === 'POST') return postRun(req, kv, username);
    return json({ error: 'method not allowed' }, 405);
  }

  return json({ error: 'not found' }, 404);
}

async function postTriggers(req: Request, kv: KVNamespace): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be valid JSON' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return json({ error: 'body must be a JSON object' }, 400);
  }
  const raw = (body as { usernames?: unknown }).usernames;
  if (!Array.isArray(raw)) {
    return json({ error: 'usernames must be a string array' }, 400);
  }
  const usernames = raw
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .map((u) => u.toLowerCase());
  if (usernames.length === 0) {
    return json({ created: 0 }, 200);
  }
  // Limit batch size — operator triggers should be intentional, not bulk.
  if (usernames.length > 500) {
    return json({ error: 'too many usernames in one request (max 500)' }, 400);
  }
  const requested_at = new Date().toISOString();
  await Promise.all(
    usernames.map((u) =>
      kv.put(
        `${TRIGGER_PREFIX}${u}`,
        JSON.stringify({ requested_at }),
        { expirationTtl: TRIGGER_TTL_SECONDS },
      ),
    ),
  );
  return json({ created: usernames.length }, 200);
}

async function listTriggers(kv: KVNamespace): Promise<Response> {
  const usernames: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const res: {
      keys: { name: string }[];
      list_complete: boolean;
      cursor?: string;
    } = await kv.list({ prefix: TRIGGER_PREFIX, cursor });
    for (const k of res.keys) {
      usernames.push(k.name.slice(TRIGGER_PREFIX.length));
    }
    if (res.list_complete) break;
    cursor = res.cursor;
  }
  return json({ usernames }, 200);
}

async function postRun(
  req: Request,
  kv: KVNamespace,
  username: string,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body must be valid JSON' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return json({ error: 'body must be a JSON object' }, 400);
  }
  const bodyObj = body as Record<string, unknown>;
  // Server-stamped timestamp when client didn't include one.
  const startedRaw = bodyObj.started_at;
  const started =
    typeof startedRaw === 'string' && startedRaw.length > 0
      ? startedRaw
      : new Date().toISOString();
  const record = {
    ...bodyObj,
    username,
    started_at: started,
    stored_at: Date.now(),
  };
  // Key includes the started_at timestamp so a single account's runs
  // sort lexicographically (which is also chronologically when the
  // timestamps are properly formatted ISO-8601 with `Z` suffix).
  const key = `${RUN_PREFIX}${username.toLowerCase()}:${started}`;
  await kv.put(key, JSON.stringify(record), {
    expirationTtl: RUN_TTL_SECONDS,
    metadata: { status: typeof bodyObj.status === 'string' ? bodyObj.status : 'unknown' },
  });
  return json({ ok: true }, 200);
}

async function listRuns(req: Request, kv: KVNamespace): Promise<Response> {
  const url = new URL(req.url);
  const username = (url.searchParams.get('username') ?? '').toLowerCase();
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(limitRaw, MAX_RUN_LIMIT)
    : DEFAULT_RUN_LIMIT;

  const prefix = username ? `${RUN_PREFIX}${username}:` : RUN_PREFIX;

  // KV list returns keys sorted lexicographically — when we list across
  // every user, that ordering interleaves users rather than honoring time.
  // Sort by the ISO timestamp suffix (descending) to get newest-first
  // regardless of which user produced the run.
  const collected: { name: string }[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res: {
      keys: { name: string }[];
      list_complete: boolean;
      cursor?: string;
    } = await kv.list({ prefix, cursor });
    collected.push(...res.keys);
    if (res.list_complete) break;
    cursor = res.cursor;
    // Bound work even on huge histories; we only need the latest `limit`.
    if (collected.length >= limit * 4) break;
  }
  collected.sort((a, b) => {
    const ta = timestampSuffix(a.name);
    const tb = timestampSuffix(b.name);
    return ta < tb ? 1 : ta > tb ? -1 : 0;
  });
  const head = collected.slice(0, limit);
  const runs: unknown[] = [];
  for (const k of head) {
    const raw = await kv.get(k.name);
    if (raw) {
      try {
        runs.push(JSON.parse(raw));
      } catch {
        // skip malformed
      }
    }
  }
  return json({ runs }, 200);
}

function timestampSuffix(name: string): string {
  // Key is `warm-run:<username>:<iso8601>`. Username has no `:`, ISO does
  // (e.g. `T12:00:00Z`), so split off the username after the prefix and
  // return whatever remains.
  if (!name.startsWith(RUN_PREFIX)) return '';
  const tail = name.slice(RUN_PREFIX.length);
  const i = tail.indexOf(':');
  return i >= 0 ? tail.slice(i + 1) : '';
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
