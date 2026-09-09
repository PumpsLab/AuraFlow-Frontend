import { apiGet, apiPost } from "./client";

export function getCompany(employerWallet: string, sessionToken: string) {
  return apiGet(`/companies/me?employerWallet=${employerWallet}`, { "x-auraflow-session": sessionToken });
}

export function createCompany(data: { name: string; employerWallet: string }, sessionToken: string) {
  return apiPost("/companies", data, { "x-auraflow-session": sessionToken });
}

export function getCompanyBalance(companyId: string, wallet: string, sessionToken: string) {
  return apiGet(`/companies/${companyId}/balance?wallet=${wallet}`, { "x-auraflow-session": sessionToken });
}

export function getCompanyTreasury(companyId: string, wallet: string, sessionToken: string) {
  return apiGet(`/companies/${companyId}/treasury?wallet=${wallet}`, { "x-auraflow-session": sessionToken });
}

export function withdrawFromTreasury(companyId: string, data: { amount: number; destinationAddress: string }, wallet: string, sessionToken: string) {
  return apiPost(`/companies/${companyId}/withdraw?wallet=${wallet}`, data, { "x-auraflow-session": sessionToken });
}

export function getFundingInstructions(companyId: string, wallet: string, sessionToken: string) {
  return apiGet(`/companies/${companyId}/funding-instructions?wallet=${wallet}`, { "x-auraflow-session": sessionToken });
}