import { describe, expect, it } from 'vitest';
import { redditExtractor } from '../src/sources/reddit';

const verifyEmail = {
  from: 'noreply@reddit.com',
  subject: 'Verify your Reddit email address',
  text: [
    'Hey there,',
    '',
    'Thanks for joining Reddit. Please verify your email address by clicking the link below:',
    '',
    'https://www.reddit.com/verification/abc123def456xyz',
    '',
    'Your verification code is 847293 in case you need it.',
  ].join('\n'),
  html: '<p>Click <a href="https://www.reddit.com/verification/abc123def456xyz">here</a></p>',
};

describe('redditExtractor', () => {
  it('matches reddit.com senders', () => {
    expect(redditExtractor.matches(verifyEmail)).toBe(true);
  });

  it('matches redditmail.com senders', () => {
    expect(redditExtractor.matches({ ...verifyEmail, from: 'noreply@redditmail.com' })).toBe(true);
  });

  it('rejects non-reddit senders', () => {
    expect(redditExtractor.matches({ ...verifyEmail, from: 'someone@example.com' })).toBe(false);
  });

  it('extracts the verification link', () => {
    const result = redditExtractor.extract(verifyEmail);
    expect(result.link).toBe('https://www.reddit.com/verification/abc123def456xyz');
  });

  it('extracts a 6-digit code when present', () => {
    const result = redditExtractor.extract(verifyEmail);
    expect(result.code).toBe('847293');
  });

  it('returns empty artifacts on mail with no verify link', () => {
    const result = redditExtractor.extract({
      from: 'noreply@reddit.com',
      subject: 'Welcome to Reddit',
      text: 'No link here.',
      html: '',
    });
    expect(result.link).toBeUndefined();
  });

  it('decodes HTML entities in the extracted link', () => {
    const result = redditExtractor.extract({
      from: 'noreply@reddit.com',
      subject: 'Verify',
      text: '',
      html: 'Click <a href="https://www.reddit.com/verification/abc?x=1&amp;y=2">here</a>',
    });
    expect(result.link).toBe('https://www.reddit.com/verification/abc?x=1&y=2');
  });
});
