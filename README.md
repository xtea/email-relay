# email-relay

A tiny Cloudflare Worker that receives incoming emails on a domain you own, parses out verification links / one-time codes, and serves them over a bearer-token-protected HTTPS endpoint.

Useful whenever an automation needs programmatic access to codes that arrive by email — new-account verifications, magic-link sign-ins, password resets — without having to open IMAP on a real inbox.

Ships with a Reddit extractor out of the box. Adding new sources is one file.

## How it works

```
    sender (e.g. Reddit)  ──email──▶  your domain catch-all  ──routing──▶  email Worker
                                                                                │
                                                                          parse + classify
                                                                                │
                                                                       Workers KV (INBOX)
                                                                                │
    your automation  ◀─── HTTPS GET /inbox/<email>?source=reddit ───────────────┘
                              Authorization: Bearer $INBOX_TOKEN
```

1. A **catch-all email route** (configured in the Cloudflare dashboard) forwards every message sent to `*@your-domain.com` to this Worker.
2. The Worker parses the raw RFC822 message with [postal-mime](https://github.com/postalsys/postal-mime), classifies the sender, and runs a source-specific extractor that pulls out verification links and/or numeric codes.
3. A **generic fallback** scans subject/text/html for any standalone 6-digit code, so forwarded emails and unclassified senders still yield usable `code` artifacts.
4. The result is written to Workers KV under `${source}:${recipient}` with a 1-hour TTL.
5. Your automation polls `GET /inbox/<email>?source=<name>` with a bearer token to retrieve the record.

## Requirements

- A domain on Cloudflare with **Email Routing** enabled (free).
- A Cloudflare account allowed to deploy Workers + Workers KV (free tier is enough).
- Node.js 18+ locally.

## Setup

`wrangler` is installed locally by `npm install` — invoke it via `npx` (no global install needed):

```bash
npm install
npx wrangler login                       # first run only — browser-based OAuth to Cloudflare
npx wrangler kv namespace create INBOX   # copy the returned id into wrangler.toml
npx wrangler secret put INBOX_TOKEN      # paste a random 32-byte hex string
npx wrangler deploy
```

If the browser OAuth step can't complete in your network, skip `wrangler login` and set `CLOUDFLARE_API_TOKEN` instead (create a token at https://dash.cloudflare.com/profile/api-tokens with the *Edit Cloudflare Workers* template):

```bash
export CLOUDFLARE_API_TOKEN=...
npx wrangler whoami     # should identify you
```

Then, in the Cloudflare dashboard: **Email** → **Email Routing** → **Routes** → add a **catch-all** rule for your domain that routes to the `email-relay` Worker (Action: *Send to a Worker*).

Sanity check:

```bash
curl https://email-relay.<your-subdomain>.workers.dev/healthz
# ok

curl -H "Authorization: Bearer $INBOX_TOKEN" \
     https://email-relay.<your-subdomain>.workers.dev/inbox/nobody@your-domain.com
# {}
```

## HTTP API

Transient inbox storage (1h TTL):

| Method | Path | Notes |
|---|---|---|
| `GET`  | `/healthz` | unauthenticated; returns `ok` |
| `GET`  | `/inbox/<email>?source=<name>` | auth required; returns the latest stored record for that source or `{}` |
| `GET`  | `/inbox/<email>?source=any` | returns the most recently written record regardless of source |
| `DELETE` | `/inbox/<email>?source=<name>` | auth required; clears the KV entry |

Successful inbox response:

```json
{
  "from": "noreply@reddit.com",
  "to": "user-abc123@your-domain.com",
  "subject": "Verify your email address",
  "source": "reddit",
  "received_at": 1714000000000,
  "artifacts": {
    "link": "https://www.reddit.com/verification/<token>",
    "code": "847293"
  }
}
```

## Development

```bash
npm test              # vitest unit tests (no Cloudflare services required)
npm run typecheck     # tsc --noEmit
npm run dev           # npx wrangler dev — requires .dev.vars with INBOX_TOKEN
```

## Adding a new source

A source-specific extractor is only needed when you want to pull out a non-code artifact (like a Reddit verification URL) or re-label the `source` field. For plain verification codes, the generic fallback already covers you.

1. `src/sources/<name>.ts` — implement the `Extractor` interface (match sender + extract link/code).
2. Register it in `src/index.ts` under `EXTRACTORS`.
3. Add a regex-fixture unit test in `tests/<name>.test.ts`.
4. Callers reach the new source via `?source=<name>` on the HTTPS API.

## Generic 6-digit code fallback

Any email whose subject or body contains a standalone 6-digit sequence (matching `/\b(\d{6})\b/`) gets its code auto-extracted into `artifacts.code` — even if the sender wasn't classified. Subject takes priority over body. This is what makes forwarded emails and unknown-sender verifications work out of the box.

## Security

- The HTTPS endpoint is protected only by the bearer token. Rotate the token (`npx wrangler secret put INBOX_TOKEN` + update consumers) if it ever leaks.
- Inbox entries TTL to 1 hour; older mail is self-cleaned.
- No per-IP rate limiting in this version. Add one if exposing the token outside your own infra.

## License

MIT.
