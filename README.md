# AuraFlow Frontend — Privacy-First Payroll on Stellar

> Per-second salary streaming with complete auditability for organizations and privacy for teams. Built on **Stellar Testnet + Soroban** with **Freighter**.

![Next.js](https://img.shields.io/badge/Next.js-16.2.2-black) ![React](https://img.shields.io/badge/React-19.2.4-61DAFB) ![Stellar SDK](https://img.shields.io/badge/stellar--sdk-17.0.1-blue) ![Freighter](https://img.shields.io/badge/freighter--api-6.0.1-orange) ![TS](https://img.shields.io/badge/TypeScript-5.x-3178C6)

## Latest Update — 2026-09-03 — Stellar Chain

AuraFlow is live on **Stellar Testnet + Soroban** with **Freighter**:

* **Wallet:** `lib/wallet/stellar-wallet.ts:15` connects via `isConnected() → requestAccess() → getNetworkDetails()` per [Freighter docs](https://docs.freighter.app/extension-freighter-api/connecting), `signMessage({address})` (SEP-53) and `signTransaction({address,networkPassphrase})` with `Buffer|string` support, and `WatchWalletChanges` in `hooks/useWallet.tsx:61` for account/network switching
* **Contracts:** `lib/private-payroll-api.ts:14` uses `StellarSdk.rpc.Server` + `Contract.call(...ScVal)` + `XdrLargeInt("i128")`/`Address.fromString`; network passphrase from `lib/wallet/contract-config.ts:10` (`Networks.TESTNET = "Test SDF Network ; September 2015"`)
* **Explorer:** Transactions and accounts link to `https://stellarchain.io` (`/transactions/{hash}`, `/accounts/{G...}`) with poll via `getTransaction`
* **DX:** `npm run build` + `tsc --noEmit` green, `.github/workflows/pr-review.yml:1` (6 jobs) + `.github/ISSUES.md:1` (12 backlog items)

## Tech Stack

* **App:** Next.js 16.2.2 (App Router, Turbopack) + React 19.2.4 + TypeScript 5 (strict)
* **Styling:** Tailwind CSS 4 + `tailwind-merge` + `framer-motion` + `lucide-react` / `@phosphor-icons/react`
* **Chain:** `@stellar/stellar-sdk 17.0.1` (`rpc.Server`, `Contract`, `TransactionBuilder`), `@stellar/freighter-api 6.0.1`, `bs58`, `@noble/curves`
* **Data:** `swr`, `zod`, `date-fns`, `papaparse`/`recharts`/`html2canvas+jspdf`
* **Tooling:** ESLint 9 (`eslint-config-next`), `typescript`, `@tailwindcss/postcss`

## Quick Start

```bash
# Node >=18 (use nvm)
nvm use 18

npm ci
cp .env.example .env.local
# edit .env.local — see Environment below

npm run dev      # http://localhost:3000
npm run build    # production build (set STELLAR env in CI)
npm run lint     # eslint
npx tsc --noEmit # typecheck
```

### Freighter (required)

Install the browser extension for Stellar Testnet:

* Chrome: <https://chromewebstore.google.com/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk>
* Firefox: <https://addons.mozilla.org/en-US/firefox/addon/freighter/>
* Fund testnet XLM: <https://faucet.stellar.org> (or Friendbot via Freighter)

> AuraFlow is deployed on **Stellar Testnet**. Ensure Freighter is switched to **TESTNET** — the app shows `Stellar Testnet Network Online` when connected (`components/ui/network-switch-guide.tsx:20`).

## Environment

`.env.example`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_STELLAR_NETWORK=testnet     # testnet | mainnet
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org

# Deployed Soroban contracts (leave empty until deployed — app falls back to "0")
CONFIDENTIAL_TOKEN_CONTRACT=
PAYROLL_CONTRACT=
USDC_CONTRACT=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```

Derived (`lib/wallet/contract-config.ts:10`):

```ts
STELLAR_NETWORK_PASSPHRASE = STELLAR_NETWORK === "mainnet"
  ? Networks.PUBLIC  // "Public Global Stellar Network ; September 2015"
  : Networks.TESTNET // "Test SDF Network ; September 2015"
```

Explorer base: `https://stellarchain.io` (`/transactions/{hash}`, `/accounts/{G...}`).

## Architecture

Frontend is UI + wallet + API consumption. Backend (AuraFlow API) owns DB, TEE treasury, and session auth.

```
app/                  # Next.js routes (/, /dashboard, /treasury, /claim/*, /disburse/*, /people/*, /pitch/*)
components/           # ui/, landing/, claim/, wallet-provider, connect-wallet-btn, deposit/withdraw modals
hooks/useWallet.tsx   # Freighter state + WatchWalletChanges (restores via getAddress without prompt)
lib/wallet/           # stellar-wallet.ts (requestAccess flow), contract-config.ts, sign-headers.ts, wallet-auth-fetch.ts
lib/private-payroll-api.ts # rpc.Server.queryContract + TransactionBuilder (no mocks)
lib/api/              # REST clients (companies, payroll-runs, employees, claims)
```

**Auth flow:** `sign-headers.ts:34` builds `AuraFlow Request Authorization\nversion:1\nwallet:G...\nmethod:POST\npath:/api/v1/auth/session\nbodySha256:...` → `signMessage` (SEP-53) → `x-auraflow-*` headers → `wallet-auth-fetch.ts:41` creates `x-auraflow-session` (cached in `sessionStorage`).

**Tx flow:** `deposit/withdraw/buildPrivateTransfer` build unsigned XDR with `STELLAR_NETWORK_PASSPHRASE` → `signTransaction({address,networkPassphrase})` in Freighter → `rpc.Server.sendTransaction()` → poll `getTransaction` → link to `stellarchain.io`.

## Scripts

| Script | What |
| --- | --- |
| `dev` | `next dev` |
| `build` | `next build` (requires STELLAR env in CI — see workflow) |
| `start` | `next start` |
| `lint` | `eslint` (Next core-web-vitals + typescript) |

## CI / PR Review

`.github/workflows/pr-review.yml` runs on every `pull_request` to `main/master/develop`:

`lint` | `typecheck` (`tsc --noEmit`) | `build` (mock `STELLAR` env) | `audit` | `stale-check` | `wallet-smoke` → sticky PR comment. `codeql.yml` for security.

Templates: `.github/pull_request_template.md`, `ISSUE_TEMPLATE/bug_report.yml`, `CODEOWNERS` for `lib/wallet/`.

Backlog: `.github/ISSUES.md` (12 issues) — run `bash scripts/create-issues.sh [owner/repo]` with `gh auth login`.

## Troubleshooting

* **"Freighter is not installed"** — `lib/wallet/stellar-wallet.ts:21` checks `isConnected().isConnected` first per docs.
* **"No address returned"** — approve `requestAccess` popup; `getAddress()` alone returns `""` if not allowed.
* **Wrong network** — `getNetworkDetails()` vs `STELLAR_NETWORK_PASSPHRASE` mismatch shows `NetworkSwitchGuide`.
* **Contract empty → balance 0** — `getBalance` catches errors to `"0"`; set `NEXT_PUBLIC_*_CONTRACT` per env.
* **`globalIgnores` error** — fixed in `eslint.config.mjs:1` (`globalIgores` typo).

## Contributing

PRs must pass the 6 PR Review jobs. Use `useWallet()` / `stellar-wallet.ts` wrappers — no direct `Freighter.*` outside `lib/`.

## License

MIT — see `LICENSE`.

## Reference

* Freighter API: <https://docs.freighter.app>
* Stellar SDK: <https://github.com/stellar/js-stellar-sdk>
* Soroban Docs: <https://soroban.stellar.org/docs>
* Testnet: <https://testnet.stellar.org>, Faucet: <https://faucet.stellar.org>, Explorer: <https://stellarchain.io>
