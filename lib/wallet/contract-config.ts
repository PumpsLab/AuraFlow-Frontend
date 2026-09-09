// Configuration for AuraFlow Soroban contracts on Stellar testnet.
import { Networks } from "@stellar/stellar-sdk";

export const STELLAR_NETWORK =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as "testnet" | "mainnet") || "testnet";

export const STELLAR_RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";

export const STELLAR_NETWORK_PASSPHRASE =
  STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

export const CONFIDENTIAL_TOKEN_CONTRACT =
  process.env.NEXT_PUBLIC_CONFIDENTIAL_TOKEN_CONTRACT || "";

export const PAYROLL_CONTRACT =
  process.env.NEXT_PUBLIC_PAYROLL_CONTRACT || "";

export const USDC_CONTRACT =
  process.env.NEXT_PUBLIC_USDC_CONTRACT ||
  (STELLAR_NETWORK === "mainnet"
    ? "" // set NEXT_PUBLIC_USDC_CONTRACT for mainnet SAC (e.g. GA5Z... issuer contract)
    : "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA");

export const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ||
  (STELLAR_NETWORK === "mainnet"
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");

export const HORIZON_URL =
  STELLAR_NETWORK === "mainnet" ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org";

// Soroban contract method names
export const CONFIDENTIAL_TOKEN_METHODS = {
  register: "register",
  deposit: "deposit",
  confidential_transfer: "confidential_transfer",
  withdraw: "withdraw",
  get_commitment: "get_commitment",
} as const;

export const PAYROLL_METHODS = {
  fund_treasury: "fund_treasury",
  register_employee_vault: "register_employee_vault",
  process_payroll_batch: "process_payroll_batch",
  get_treasury_balance: "get_treasury_balance",
  withdraw_treasury: "withdraw_treasury",
} as const;
