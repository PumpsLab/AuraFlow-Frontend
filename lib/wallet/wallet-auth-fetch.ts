"use client";

import { AURAFLOW_SESSION_HEADER } from "./auth-headers";

const SESSION_STORAGE_PREFIX = "auraflow-wallet-session";
const SESSION_EXPIRY_LEEWAY_MS = 60 * 1000;

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const walletSessionCache = new Map<string, { sessionToken: string; expiresAt: number }>();
const walletSessionCreationCache = new Map<string, Promise<{ sessionToken: string; expiresAt: number }>>();

function getSessionStorageKey(wallet: string) {
  return `${SESSION_STORAGE_PREFIX}:${wallet}`;
}

export function loadCachedWalletSession(wallet: string) {
  const inMemory = walletSessionCache.get(wallet);
  if (inMemory && inMemory.expiresAt > Date.now() + SESSION_EXPIRY_LEEWAY_MS) return inMemory;
  if (inMemory) walletSessionCache.delete(wallet);
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(getSessionStorageKey(wallet));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.sessionToken !== "string" || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now() + SESSION_EXPIRY_LEEWAY_MS) {
      window.sessionStorage.removeItem(getSessionStorageKey(wallet));
      return null;
    }
    walletSessionCache.set(wallet, parsed);
    return parsed;
  } catch { return null; }
}

export function clearWalletSession(wallet: string) {
  walletSessionCache.delete(wallet);
  if (typeof window === "undefined") return;
  try { window.sessionStorage.removeItem(getSessionStorageKey(wallet)); } catch {}
}

function persistWalletSession(wallet: string, session: { sessionToken: string; expiresAt: number }) {
  walletSessionCache.set(wallet, session);
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(getSessionStorageKey(wallet), JSON.stringify(session)); } catch {}
}

async function createWalletSession(input: { wallet: string; signMessage: (message: string) => Promise<string> }) {
  const { createSignedWalletRequestHeaders } = await import("./sign-headers");
  const bodyText = JSON.stringify({ wallet: input.wallet });
  const authHeaders = await createSignedWalletRequestHeaders({
    wallet: input.wallet, method: "POST", path: "/api/v1/auth/session", body: bodyText, signBytes: input.signMessage,
  });
  const response = await fetch(`${API_BASE}/api/v1/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...Object.fromEntries(authHeaders.entries()) },
    body: bodyText,
  });
  const json = await response.json();
  if (!response.ok || !json.sessionToken || !json.expiresAt) throw new Error(json.error || "Failed to create session");
  const expiresAt = Date.parse(json.expiresAt);
  if (!Number.isFinite(expiresAt)) throw new Error("Invalid session expiry");
  const session = { sessionToken: json.sessionToken, expiresAt };
  persistWalletSession(input.wallet, session);
  return session;
}

async function createWalletSessionDeduped(input: { wallet: string; signMessage: (message: string) => Promise<string> }) {
  const existing = walletSessionCreationCache.get(input.wallet);
  if (existing) return existing;
  const pending = createWalletSession(input).finally(() => walletSessionCreationCache.delete(input.wallet));
  walletSessionCreationCache.set(input.wallet, pending);
  return pending;
}

export async function getOrCreateWalletSession(input: { wallet: string; signMessage: (message: string) => Promise<string> }) {
  const cached = loadCachedWalletSession(input.wallet);
  if (cached) return cached;
  return createWalletSessionDeduped(input);
}

export async function walletAuthenticatedFetch(input: { wallet: string; signMessage: (message: string) => Promise<string>; path: string; method?: string; body?: unknown; headers?: HeadersInit }) {
  const method = input.method ?? "GET";
  const bodyText = input.body === undefined ? undefined : JSON.stringify(input.body);
  const headers = new Headers(input.headers);
  const session = await getOrCreateWalletSession({ wallet: input.wallet, signMessage: input.signMessage });
  headers.set(AURAFLOW_SESSION_HEADER, session.sessionToken);
  if (bodyText && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const url = input.path.startsWith("http") ? input.path : `${API_BASE}${input.path}`;
  let response = await fetch(url, { method, headers, body: bodyText });

  if (response.status === 401 || response.status === 403) {
    const renewed = await createWalletSessionDeduped({ wallet: input.wallet, signMessage: input.signMessage });
    headers.set(AURAFLOW_SESSION_HEADER, renewed.sessionToken);
    response = await fetch(url, { method, headers, body: bodyText });
  }

  return response;
}