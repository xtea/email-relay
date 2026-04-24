import { handleAccounts } from './accounts';
import { parseEmailStream } from './parse';
import type { Extractor, ExtractorResult } from './sources/base';
import { extractGenericCode } from './sources/generic';
import { redditExtractor } from './sources/reddit';
import type { Env, InboxRecord } from './types';

const EXTRACTORS: Extractor[] = [redditExtractor];
const INBOX_TTL_SECONDS = 3600; // 1 hour

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const to = (message.to ?? '').toLowerCase();
    if (!to) return;

    const parsed = await parseEmailStream(message.raw);

    const extractor = EXTRACTORS.find((e) => e.matches(parsed));
    const source = extractor?.name ?? 'unknown';
    const artifacts: ExtractorResult = extractor ? extractor.extract(parsed) : {};

    // Generic fallback: if no source-specific extractor found a code, scan
    // subject/text/html for any standalone 6-digit sequence. This keeps
    // forwarded emails and unclassified senders useful.
    if (!artifacts.code) {
      const generic = extractGenericCode(parsed);
      if (generic) artifacts.code = generic;
    }

    const record: InboxRecord = {
      from: parsed.from,
      to,
      subject: parsed.subject,
      source,
      received_at: Date.now(),
      artifacts,
    };

    const key = `${source}:${to}`;
    await env.INBOX.put(key, JSON.stringify(record), {
      expirationTtl: INBOX_TTL_SECONDS,
    });

    // Index so callers who don't know the source can still find the latest hit.
    await env.INBOX.put(
      `recent:${to}`,
      JSON.stringify({ source, key }),
      { expirationTtl: INBOX_TTL_SECONDS },
    );
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/healthz') {
      return new Response('ok', { status: 200 });
    }

    if (!env.INBOX_TOKEN) {
      return json({ error: 'server misconfigured: INBOX_TOKEN unset' }, 500);
    }

    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${env.INBOX_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401);
    }

    // Accounts: persistent credentials store (separate from transient inbox).
    if (url.pathname === '/accounts' || url.pathname.startsWith('/accounts/')) {
      return handleAccounts(req, env.INBOX, url.pathname);
    }

    const match = url.pathname.match(/^\/inbox\/([^/]+)$/);
    if (!match) {
      return json({ error: 'not found' }, 404);
    }
    const email = decodeURIComponent(match[1]).toLowerCase();
    const source = (url.searchParams.get('source') ?? 'reddit').toLowerCase();

    if (req.method === 'GET') {
      const key = source === 'any' ? await resolveRecentKey(env, email) : `${source}:${email}`;
      if (!key) return json({}, 200);
      const raw = await env.INBOX.get(key);
      if (!raw) return json({}, 200);
      return new Response(raw, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (req.method === 'DELETE') {
      await env.INBOX.delete(`${source}:${email}`);
      await env.INBOX.delete(`recent:${email}`);
      return json({ deleted: true }, 200);
    }

    return json({ error: 'method not allowed' }, 405);
  },
};

async function resolveRecentKey(env: Env, email: string): Promise<string | null> {
  const raw = await env.INBOX.get(`recent:${email}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { key: string };
    return parsed.key;
  } catch {
    return null;
  }
}

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
