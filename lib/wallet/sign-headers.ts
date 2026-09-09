import { AURAFLOW_AUTH_WALLET_HEADER, AURAFLOW_AUTH_TIMESTAMP_HEADER, AURAFLOW_AUTH_SIGNATURE_HEADER } from "./auth-headers";

const AUTH_MESSAGE_PREFIX = "AuraFlow Request Authorization";
const AUTH_VERSION = "1";

function normalizePath(path: string) {
  try {
    const url = new URL(path, "http://localhost");
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    return `${pathname}${url.search}`;
  } catch {
    let normalized = path;
    if (normalized.length > 1 && normalized.endsWith("/")) normalized = normalized.slice(0, -1);
    return normalized;
  }
}

function bytesToHex(value: Uint8Array) {
  return Array.from(value).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

async function buildWalletRequestAuthMessage(input: { wallet: string; method: string; path: string; timestamp: string; body?: string }) {
  const bodySha256 = await sha256Hex(input.body ?? "");
  return [AUTH_MESSAGE_PREFIX, `version:${AUTH_VERSION}`, `wallet:${input.wallet}`, `method:${input.method.toUpperCase()}`, `path:${normalizePath(input.path)}`, `timestamp:${input.timestamp}`, `bodySha256:${bodySha256}`].join("\n");
}

export async function createSignedWalletRequestHeaders(input: { wallet: string; method: string; path: string; body?: string; signBytes: (message: string) => Promise<string> }) {
  const timestamp = new Date().toISOString();
  const message = await buildWalletRequestAuthMessage({ wallet: input.wallet, method: input.method, path: input.path, timestamp, body: input.body });
  const signature = await input.signBytes(message);
  const headers = new Headers();
  headers.set(AURAFLOW_AUTH_WALLET_HEADER, input.wallet);
  headers.set(AURAFLOW_AUTH_TIMESTAMP_HEADER, timestamp);
  headers.set(AURAFLOW_AUTH_SIGNATURE_HEADER, signature);
  return headers;
}