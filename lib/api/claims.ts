import { apiGet, apiPost, apiPatch } from "./client";

export function getClaimBalance(employeeWallet: string) {
  return apiGet(`/claim/balance?employeeWallet=${employeeWallet}`);
}

export function listCashoutRequests(params: { employeeWallet?: string; employerWallet?: string; scope?: string }, sessionToken?: string) {
  const query = new URLSearchParams(params as any).toString();
  return apiGet(`/cashout-requests?${query}`, sessionToken ? { "x-auraflow-session": sessionToken } : undefined);
}

export function createCashoutRequest(data: any, sessionToken: string) {
  return apiPost("/cashout-requests", data, { "x-auraflow-session": sessionToken });
}

export function resolveCashoutRequest(data: any, sessionToken: string) {
  return apiPatch("/cashout-requests", data, { "x-auraflow-session": sessionToken });
}

export function processClaimSalary(data: any, sessionToken: string) {
  return apiPost("/claim-salary/process", data, { "x-auraflow-session": sessionToken });
}