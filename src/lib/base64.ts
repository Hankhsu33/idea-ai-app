const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encodes bytes to base64.
 *
 * React Native has no `btoa` and no `Buffer`, and expo-file-system's native base64
 * reader only works on a whole file — which for the 44 MB weights would mean holding a
 * ~59 MB string. This encodes one bridge-sized slice at a time instead.
 *
 * The output alphabet is `A-Za-z0-9+/=` only, which is why chunks can be interpolated
 * straight into an injected JavaScript string literal without escaping.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  const remainder = len % 3;
  const mainLength = len - remainder;

  const parts: string[] = [];
  let buffer = '';

  for (let i = 0; i < mainLength; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    buffer +=
      ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];

    // Flushing keeps the intermediate rope shallow on very large inputs.
    if (buffer.length >= 16384) {
      parts.push(buffer);
      buffer = '';
    }
  }

  if (remainder === 1) {
    const n = bytes[mainLength] << 16;
    buffer += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + '==';
  } else if (remainder === 2) {
    const n = (bytes[mainLength] << 16) | (bytes[mainLength + 1] << 8);
    buffer += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + '=';
  }

  if (buffer) parts.push(buffer);
  return parts.join('');
}

const LOOKUP = /* @__PURE__ */ (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/**
 * Decodes base64 to bytes.
 *
 * Needed because `File.write(content, { encoding: 'base64' })` cannot be used here:
 * the write-options overload only landed in expo-file-system 19.0.16, while the native
 * module frozen inside Expo Go for SDK 54 predates it and rejects the third argument
 * with `InvalidArgsNumberException`. Writing a Uint8Array is a two-argument call that
 * both the old and the new native signature accept.
 */
export function base64ToBytes(base64: string): Uint8Array {
  let clean = base64;
  // Tolerate data: prefixes and stray whitespace from any producer.
  const comma = clean.indexOf(',');
  if (clean.startsWith('data:') && comma >= 0) clean = clean.slice(comma + 1);
  if (/\s/.test(clean)) clean = clean.replace(/\s+/g, '');

  let length = clean.length;
  while (length > 0 && clean.charCodeAt(length - 1) === 61 /* '=' */) length -= 1;

  const out = new Uint8Array(Math.floor((length * 3) / 4));
  let outIndex = 0;
  let accumulator = 0;
  let bits = 0;

  for (let i = 0; i < length; i++) {
    const value = LOOKUP[clean.charCodeAt(i)];
    if (value === 255) throw new Error('invalid base64 input');
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (accumulator >> bits) & 0xff;
    }
  }

  return outIndex === out.length ? out : out.subarray(0, outIndex);
}
