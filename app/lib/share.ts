// Share links carry the whole machine in the URL fragment, so nothing is ever
// uploaded: #m=<base64url(deflate-raw(minified JSON))>. Fragments are not sent
// to the server by browsers.
import { LIMITS } from '../../simulator/protocol';

const PREFIX = 'm=';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value))
    throw new Error('The link contains characters that are not base64url');
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('The shared machine exceeds 256 KB');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function transform(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit: number,
) {
  const writer = stream.writable.getWriter();
  // Errors surface through the readable side; keep the writer quiet.
  writer.write(bytes as Uint8Array<ArrayBuffer>).catch(() => {});
  writer.close().catch(() => {});
  return pump(stream.readable, limit);
}

/** Minifies valid JSON so links stay short; other text is kept verbatim. */
function compact(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}

/** Returns the fragment payload (without '#'), e.g. `m=…`. */
export async function encodeMachine(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(compact(text));
  if (bytes.byteLength > LIMITS.fileBytes)
    throw new Error('Machine exceeds 256 KB');
  const packed = await transform(
    bytes,
    new CompressionStream('deflate-raw'),
    Number.POSITIVE_INFINITY,
  );
  return PREFIX + toBase64Url(packed);
}

/** The machine payload in a location hash, or null when there is none. */
export function machinePayload(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const value = params.get('m');
  return value === null ? null : value;
}

/** Decodes a `#m=…` payload back to JSON text (not yet validated). */
export async function decodeMachine(payload: string): Promise<string> {
  if (!payload) throw new Error('The link has an empty machine payload');
  let bytes: Uint8Array;
  try {
    bytes = await transform(
      fromBase64Url(payload),
      new DecompressionStream('deflate-raw'),
      LIMITS.fileBytes,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('256 KB')) throw error;
    throw new Error('The link is truncated or not a machine link');
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/** Absolute link to this page carrying the machine. */
export async function shareUrl(text: string, base: string): Promise<string> {
  const url = new URL(base);
  url.hash = await encodeMachine(text);
  return url.toString();
}
