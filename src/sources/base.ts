import type { ParsedEmail } from '../parse';

export type SourceName = 'reddit' | 'unknown';

export interface ExtractorResult {
  link?: string;
  code?: string;
}

export interface Extractor {
  readonly name: SourceName;
  matches(email: ParsedEmail): boolean;
  extract(email: ParsedEmail): ExtractorResult;
}
