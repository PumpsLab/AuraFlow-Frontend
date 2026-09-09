import { apiGet, apiPost, apiPatch } from "./client";

export function listEmployees(employerWallet: string, sessionToken: string) {
  return apiGet(`/employees?employerWallet=${employerWallet}`, { "x-auraflow-session": sessionToken });
}

export function createEmployee(data: any, sessionToken: string) {
  return apiPost("/employees", data, { "x-auraflow-session": sessionToken });
}

export function updateEmployee(employeeId: string, data: any, sessionToken: string) {
  return apiPatch(`/employees/${employeeId}`, data, { "x-auraflow-session": sessionToken });
}

export function privateInit(data: any, sessionToken: string) {
  return apiPost("/employees/private-init", data, { "x-auraflow-session": sessionToken });
}

export function autoInit(data: any, sessionToken: string) {
  return apiPost("/employees/auto-init", data, { "x-auraflow-session": sessionToken });
}

export function getPrivateInitStatus(employeeWallet: string) {
  return apiGet(`/employees/private-init-status?employeeWallet=${employeeWallet}`);
}