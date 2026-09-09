import { apiGet, apiPost, apiDelete } from "./client";

export function getHistory(wallet: string, sessionToken: string, scope?: string) {
  return apiGet(`/history?wallet=${wallet}&scope=${scope || ""}`, { "x-auraflow-session": sessionToken });
}

export function saveHistoryRecord(data: any, sessionToken: string) {
  return apiPost("/history", data, { "x-auraflow-session": sessionToken });
}

export function clearHistory(wallet: string, sessionToken: string) {
  return apiDelete(`/history?wallet=${wallet}`, { "x-auraflow-session": sessionToken });
}