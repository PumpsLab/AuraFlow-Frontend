import { apiGet, apiPost, apiDelete } from "./client";

export function getAuditData(token: string) {
  return apiGet(`/audit?token=${token}`);
}

export function listAuditorTokens(employerWallet: string, sessionToken: string) {
  return apiGet(`/auditor-tokens?employerWallet=${employerWallet}`, { "x-auraflow-session": sessionToken });
}

export function createAuditorToken(data: { employerWallet: string; label?: string }, sessionToken: string) {
  return apiPost("/auditor-tokens", data, { "x-auraflow-session": sessionToken });
}

export function revokeAuditorToken(data: { id: string }, sessionToken: string) {
  return apiDelete("/auditor-tokens", { "x-auraflow-session": sessionToken, body: JSON.stringify(data) } as any);
}