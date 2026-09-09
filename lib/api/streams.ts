import { apiGet, apiPost, apiPatch } from "./client";

export function listStreams(employerWallet: string, sessionToken: string) {
  return apiGet(`/streams?employerWallet=${employerWallet}`, { "x-auraflow-session": sessionToken });
}

export function createStream(data: any, sessionToken: string) {
  return apiPost("/streams", data, { "x-auraflow-session": sessionToken });
}

export function updateStream(data: any, sessionToken: string) {
  return apiPatch("/streams", data, { "x-auraflow-session": sessionToken });
}

export function controlStreamPost(data: any, sessionToken: string) {
  return apiPost("/streams/control", data, { "x-auraflow-session": sessionToken });
}

export function controlStreamPatch(data: any, sessionToken: string) {
  return apiPatch("/streams/control", data, { "x-auraflow-session": sessionToken });
}

export function onboardStreamPost(data: any, sessionToken: string) {
  return apiPost("/streams/onboard", data, { "x-auraflow-session": sessionToken });
}

export function onboardStreamPatch(data: any, sessionToken: string) {
  return apiPatch("/streams/onboard", data, { "x-auraflow-session": sessionToken });
}

export function restartStreamPost(data: any, sessionToken: string) {
  return apiPost("/streams/restart", data, { "x-auraflow-session": sessionToken });
}

export function restartStreamPatch(data: any, sessionToken: string) {
  return apiPatch("/streams/restart", data, { "x-auraflow-session": sessionToken });
}