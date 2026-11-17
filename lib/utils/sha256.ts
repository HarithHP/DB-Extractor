import { toHex } from "./encoding";

const enc = new TextEncoder();

export async function sha256Hex(content: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof content === "string" ? enc.encode(content) : content;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

export function utf8ByteLength(content: string): number {
  return enc.encode(content).byteLength;
}
