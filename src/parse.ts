import PostalMime from 'postal-mime';

export interface ParsedEmail {
  from: string;
  subject: string;
  text: string;
  html: string;
}

export async function parseEmailStream(raw: ReadableStream<Uint8Array>): Promise<ParsedEmail> {
  const buf = await streamToArrayBuffer(raw);
  return parseEmailBuffer(buf);
}

export async function parseEmailBuffer(buf: ArrayBuffer | Uint8Array | string): Promise<ParsedEmail> {
  const parsed = await PostalMime.parse(buf);
  const fromAddr = parsed.from?.address ?? '';
  return {
    from: fromAddr.toLowerCase(),
    subject: parsed.subject ?? '',
    text: parsed.text ?? '',
    html: parsed.html ?? '',
  };
}

async function streamToArrayBuffer(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}
