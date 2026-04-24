import { describe, expect, it } from 'vitest';
import { extractGenericCode } from '../src/sources/generic';

describe('extractGenericCode', () => {
  it('extracts a 6-digit code from subject', () => {
    const code = extractGenericCode({
      from: 'whoever@example.com',
      subject: '343762 is your verification code',
      text: '',
      html: '',
    });
    expect(code).toBe('343762');
  });

  it('extracts a 6-digit code from text body', () => {
    const code = extractGenericCode({
      from: 'whoever@example.com',
      subject: 'Fwd: verify',
      text: 'Your code is 284915 — valid for 10 minutes.',
      html: '',
    });
    expect(code).toBe('284915');
  });

  it('prefers subject over body when both match', () => {
    const code = extractGenericCode({
      from: 'whoever@example.com',
      subject: '111111 is your code',
      text: 'Confirm with 222222',
      html: '',
    });
    expect(code).toBe('111111');
  });

  it('returns undefined when no 6-digit sequence exists', () => {
    const code = extractGenericCode({
      from: 'whoever@example.com',
      subject: 'Welcome aboard',
      text: 'Thanks for signing up!',
      html: '',
    });
    expect(code).toBeUndefined();
  });

  it('ignores 7+ digit numbers', () => {
    const code = extractGenericCode({
      from: 'whoever@example.com',
      subject: 'order 12345678 confirmation',
      text: '',
      html: '',
    });
    expect(code).toBeUndefined();
  });

  it('ignores 5-digit numbers', () => {
    const code = extractGenericCode({
      from: 'whoever@example.com',
      subject: 'zip 12345 is ready',
      text: '',
      html: '',
    });
    expect(code).toBeUndefined();
  });

  it('matches the FIRST 6-digit code when several exist', () => {
    const code = extractGenericCode({
      from: 'whoever@example.com',
      subject: 'your codes: 111111 222222 333333',
      text: '',
      html: '',
    });
    expect(code).toBe('111111');
  });

  it('handles forwarded-subject prefix (Fwd:)', () => {
    const code = extractGenericCode({
      from: 'you@yourself.com',
      subject: 'Fwd: 887766 is your Reddit verification code',
      text: '',
      html: '',
    });
    expect(code).toBe('887766');
  });
});
