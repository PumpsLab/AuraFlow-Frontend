export const PAYROLL_RUNTIME_BOUNDARY = {
  base: {
    label: "Stellar Testnet",
    shortLabel: "Stellar",
    description:
      "Company setup, treasury funding, and stream creations live on Stellar Testnet.",
  },
  per: {
    label: "Soroban Contracts",
    shortLabel: "Soroban",
    description:
      "Live salary accrual and streaming settlements via Soroban smart contracts.",
  },
  server: {
    label: "AuraFlow Bridge",
    shortLabel: "Bridge",
    description:
      "AuraFlow bridges wallet auth, signed snapshot reads, and stealth address generation.",
  },
} as const;

export const PAYROLL_RUNTIME_BOUNDARY_PILLS = [
  {
    key: "base",
    label: PAYROLL_RUNTIME_BOUNDARY.base.label,
    copy: PAYROLL_RUNTIME_BOUNDARY.base.description,
  },
  {
    key: "per",
    label: PAYROLL_RUNTIME_BOUNDARY.per.label,
    copy: PAYROLL_RUNTIME_BOUNDARY.per.description,
  },
] as const;
