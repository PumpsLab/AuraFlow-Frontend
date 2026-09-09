import { apiGet } from "./client";

export function getEmployeePayroll(employeeWallet: string) {
  return apiGet(`/payroll/employee?employeeWallet=${employeeWallet}`);
}

export function getStreamState(employerWallet: string, streamId: string) {
  return apiGet(`/payroll/state?employerWallet=${employerWallet}&streamId=${streamId}`);
}