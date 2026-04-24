/**
 * Generic fallback extractor.
 *
 * Runs on every incoming email regardless of sender. Looks for a 6-digit
 * code in subject/text/html (preferring subject — most verification emails
 * put the code there). Populates `artifacts.code` when a specific extractor
 * didn't already find one.
 *
 * This is why forwarded emails (from whatever forwarder address) still yield
 * usable codes even when the source can't be classified.
 */
import type { ParsedEmail } from '../parse';

// Standalone 6-digit sequence. `\b` boundary avoids swallowing digits that
// are part of longer numbers (tracking IDs, timestamps, etc.).
const SIX_DIGIT_CODE_RE = /\b(\d{6})\b/;

export function extractGenericCode(email: ParsedEmail): string | undefined {
  for (const field of [email.subject, email.text, email.html]) {
    if (!field) continue;
    const m = field.match(SIX_DIGIT_CODE_RE);
    if (m) return m[1];
  }
  return undefined;
}
