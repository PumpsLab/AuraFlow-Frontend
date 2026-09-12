import { apiGet, apiPost } from "./client";

export function listProfiles(employerWallet: string, sessionToken: string) {
  return apiGet(`/payroll-runs/profiles?employerWallet=${employerWallet}`, { "x-auraflow-session": sessionToken });
}

export function upsertProfile(data: any, sessionToken: string) {
  return apiPost("/payroll-runs/profiles", data, { "x-auraflow-session": sessionToken });
}

export function listCycles(employerWallet: string, sessionToken: string) {
  return apiGet(`/payroll-runs/cycles?employerWallet=${employerWallet}`, { "x-auraflow-session": sessionToken });
}

export function createCycle(data: any, sessionToken: string) {
  return apiPost("/payroll-runs/cycles", data, { "x-auraflow-session": sessionToken });
}

export function computeCycle(cycleId: string, data: any, sessionToken: string) {
  return apiPost(`/payroll-runs/cycles/${cycleId}/compute`, data, { "x-auraflow-session": sessionToken });
}

export function approveCycle(cycleId: string, data: any, sessionToken: string) {
  return apiPost(`/payroll-runs/cycles/${cycleId}/approve`, data, { "x-auraflow-session": sessionToken });
}

export function getDisbursementPlan(cycleId: string, employerWallet: string, sessionToken: string) {
  return apiGet(`/payroll-runs/cycles/${cycleId}/disbursement-plan?employerWallet=${employerWallet}`, { "x-auraflow-session": sessionToken });
}

export function listRuns(employerWallet: string, sessionToken: string) {
  return apiGet(`/payroll-runs/runs?employerWallet=${employerWallet}`, { "x-auraflow-session": sessionToken });
}

// TODO: Implement these backend endpoints
// export function getRun(runId: string, employerWallet: string, sessionToken: string) {
//   return apiGet(`/payroll-runs/runs/${runId}?employerWallet=${employerWallet}`, { "x-auraflow-session": sessionToken });
// }
//
// export function finalizeRun(runId: string, data: any, sessionToken: string) {
//   return apiPost(`/payroll-runs/runs/${runId}/finalize`, data, { "x-auraflow-session": sessionToken });
// }
//
// export function retryFailedRunItems(runId: string, data: any, sessionToken: string) {
//   return apiPost(`/payroll-runs/runs/${runId}/retry-failed`, data, { "x-auraflow-session": sessionToken });
// }
//
// export function markRunItemProcessing(runId: string, itemId: string, data: any, sessionToken: string) {
//   return apiPost(`/payroll-runs/runs/${runId}/items/${itemId}/processing`, data, { "x-auraflow-session": sessionToken });
// }
//
// export function resolveRunItem(runId: string, itemId: string, data: any, sessionToken: string) {
//   return apiPost(`/payroll-runs/runs/${runId}/items/${itemId}/resolve`, data, { "x-auraflow-session": sessionToken });
// }
//
// export function listStatements(employerWallet: string, sessionToken: string, scope?: string) {
//   return apiGet(`/payroll-runs/statements?employerWallet=${employerWallet}&scope=${scope || "employer"}`, { "x-auraflow-session": sessionToken });
// }