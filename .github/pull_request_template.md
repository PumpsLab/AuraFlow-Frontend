# Pull Request

## What
<!-- link to issue: Closes #<id> -->

## Why
<!-- context for Stellar migration / UX -->

## How (Stellar checklist)
- [ ] Uses `useWallet()` / `stellar-wallet.ts` (no direct `Freighter.*` outside lib)
- [ ] Uses `STELLAR_NETWORK_PASSPHRASE` from `contract-config.ts` (no hardcoded `Future Network`)
- [ ] `Contract.call` uses rest args (`...ScVal`) and `XdrLargeInt("i128")` / `Address.fromString`
- [ ] No `0x${string}` / `arbiscan` / `Future Network` refs (`grep` in CI will fail)
- [ ] Explorer links use `stellarchain.io`

## Tests
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build` (env mocked in CI)

## Screenshots / Freighter flow

## Breaking changes?
