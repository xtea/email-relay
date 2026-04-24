import type { ParsedEmail } from '../parse';
import type { Extractor, ExtractorResult } from './base';

// Reddit sends verification mail from these senders (seen in the wild).
const REDDIT_FROM_RE = /@(?:reddit\.com|redditmail\.com)$/i;

// Verification links are on reddit.com or redd.it and contain "verif",
// "confirm", or "email" somewhere in the URL.
const REDDIT_VERIFY_LINK_RE =
  /https:\/\/(?:www\.)?(?:reddit\.com|redd\.it)\/[^\s"'<>)]*?(?:verif|confirm|email)[^\s"'<>)]*/gi;

// Some Reddit flows (password reset, 2FA) include a 6-digit code in the body.
const SIX_DIGIT_CODE_RE = /\b(\d{6})\b/;

export const redditExtractor: Extractor = {
  name: 'reddit',
  matches(email) {
    return REDDIT_FROM_RE.test(email.from);
  },
  extract(email): ExtractorResult {
    const body = `${email.subject}\n${email.text}\n${email.html}`;
    const result: ExtractorResult = {};

    const linkMatches = body.match(REDDIT_VERIFY_LINK_RE);
    if (linkMatches && linkMatches.length > 0) {
      result.link = decodeHtmlEntities(linkMatches[0]);
    }

    const codeMatch = body.match(SIX_DIGIT_CODE_RE);
    if (codeMatch) {
      result.code = codeMatch[1];
    }

    return result;
  },
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
