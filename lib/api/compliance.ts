import { apiGet } from "./client";

export function listComplianceEvents(wallet: string, limit?: number) {
  return apiGet(`/compliance/events?wallet=${wallet}&limit=${limit || 25}`);
}

export function exportComplianceData(wallet: string, scope?: string) {
  return apiGet(`/compliance/export?wallet=${wallet}&scope=${scope || "owner"}`);
}