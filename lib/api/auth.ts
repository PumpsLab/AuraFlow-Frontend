import { apiPost } from "./client";

export interface SessionResponse {
  wallet: string;
  sessionToken: string;
  expiresAt: string;
}

export function createSession(wallet: string, sessionToken: string) {
  return apiPost<SessionResponse>("/auth/session", { wallet }, { "x-auraflow-session": sessionToken });
}