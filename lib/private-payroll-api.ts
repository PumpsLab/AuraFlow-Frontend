// Soroban contract integration for AuraFlow
import {
  CONFIDENTIAL_TOKEN_CONTRACT,
  PAYROLL_CONTRACT,
  USDC_CONTRACT,
  USDC_ISSUER,
  HORIZON_URL,
  STELLAR_RPC_URL,
  STELLAR_NETWORK_PASSPHRASE,
} from "./wallet/contract-config";
import * as StellarSdk from "@stellar/stellar-sdk";

let server: StellarSdk.rpc.Server | null = null;

function getServer(): StellarSdk.rpc.Server {
  if (!server) {
    server = new StellarSdk.rpc.Server(STELLAR_RPC_URL);
  }
  return server;
}

async function getNetworkPassphrase(): Promise<string> {
  try {
    const { getStellarNetworkPassphrase } = await import("./wallet/stellar-wallet");
    return await getStellarNetworkPassphrase();
  } catch {
    return STELLAR_NETWORK_PASSPHRASE;
  }
}

export interface BalanceResponse {
  balance?: string;
  location?: string;
}

export async function fetchTeeAuthToken(
  publicKey: string,
  signMessage: (message: string) => Promise<string>,
): Promise<string> {
  return await signMessage(`tee-auth-${Date.now()}`);
}

export function isJwtExpired(token: string): boolean {
  return false;
}

export async function checkHealth(): Promise<{ status: string }> {
  return { status: "ok" };
}

export async function getBalance(walletAddress: string): Promise<{ balance: string }> {
  // 1) Try Horizon classic USDC trustline (source of truth for SAC) - uses USDC_ISSUER per network
  try {
    const { Horizon } = StellarSdk;
    const server = new Horizon.Server(HORIZON_URL);
    const account = await server.loadAccount(walletAddress);
    const usdcBalance = (account.balances as Array<{ asset_code?: string; asset_issuer?: string; balance: string }>).find(
      (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER,
    );
    if (usdcBalance) {
      const stroops = Math.round(parseFloat(usdcBalance.balance) * 1_000_000).toString();
      return { balance: stroops };
    }
  } catch (e) {
    console.warn("[getBalance] Horizon fetch failed", e);
  }

  // 2) Fallback: SAC balance via Soroban RPC
  try {
    const srv = getServer();
    const passphrase = await getNetworkPassphrase();
    const result = await srv.queryContract(
      USDC_CONTRACT,
      "balance",
      { addr: StellarSdk.Address.fromString(walletAddress).toScVal() },
      passphrase,
    );
    return { balance: result.result.toString() };
  } catch (e) {
    console.warn("[getBalance] SAC query failed", e);
    return { balance: "0" };
  }
}

export async function getPrivateBalance(
  walletAddress: string,
  token: string,
): Promise<{ balance: string; location?: string }> {
  try {
    const srv = getServer();
    const passphrase = await getNetworkPassphrase();
    const result = await srv.queryContract(
      CONFIDENTIAL_TOKEN_CONTRACT,
      "get_commitment",
      { addr: StellarSdk.Address.fromString(walletAddress).toScVal() },
      passphrase,
    );
    return { balance: result.result.toString(), location: "confidential" };
  } catch {
    return { balance: "0", location: "confidential" };
  }
}

export async function deposit(
  owner: string,
  amount: number,
): Promise<{ transactionXdr: string }> {
  const srv = getServer();
  const passphrase = await getNetworkPassphrase();
  const account = await srv.getAccount(owner);
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: passphrase,
  })
    .addOperation(
      new StellarSdk.Contract(CONFIDENTIAL_TOKEN_CONTRACT).call(
        "deposit",
        StellarSdk.Address.fromString(owner).toScVal(),
        new StellarSdk.XdrLargeInt("i128", Math.round(amount * 1_000_000)).toScVal()
      ),
    )
    .setTimeout(300)
    .build();

  return { transactionXdr: String(transaction.toXdr()) };
}

export async function withdraw(
  owner: string,
  amount: number,
): Promise<{ transactionXdr: string }> {
  const srv = getServer();
  const passphrase = await getNetworkPassphrase();
  const account = await srv.getAccount(owner);
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: passphrase,
  })
    .addOperation(
      new StellarSdk.Contract(CONFIDENTIAL_TOKEN_CONTRACT).call(
        "withdraw",
        StellarSdk.Address.fromString(owner).toScVal(),
        new StellarSdk.XdrLargeInt("i128", Math.round(amount * 1_000_000)).toScVal()
      ),
    )
    .setTimeout(300)
    .build();

  return { transactionXdr: transaction.toXDR() };
}

export async function buildPrivateTransfer(params: {
  from: string;
  to: string;
  amount: number;
  outputMint: string;
  balances: { fromBalance: string; toBalance: string };
  privacy?: { delaySeconds?: number; splitCount?: number };
}): Promise<{ transactionXdr: string }> {
  const srv = getServer();
  const passphrase = await getNetworkPassphrase();
  const account = await srv.getAccount(params.from);
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: passphrase,
  })
    .addOperation(
      new StellarSdk.Contract(CONFIDENTIAL_TOKEN_CONTRACT).call(
        "confidential_transfer",
        StellarSdk.Address.fromString(params.from).toScVal(),
        StellarSdk.Address.fromString(params.to).toScVal(),
        new StellarSdk.XdrLargeInt("i128", Math.round(params.amount * 1_000_000)).toScVal()
      ),
    )
    .setTimeout(300)
    .build();

  return { transactionXdr: transaction.toXDR() };
}

export async function privateTransfer(
  from: string,
  to: string,
  amount: number,
  outputMint?: string,
  activeToken?: string,
  options?: { fromBalance?: string; toBalance?: string; sendTo?: string; [key: string]: any },
): Promise<{ transactionBase64: string; sendTo?: string }> {
  const result = await buildPrivateTransfer({
    from,
    to,
    amount,
    outputMint: outputMint || "",
    balances: {
      fromBalance: options?.fromBalance || "",
      toBalance: options?.toBalance || "",
    },
  });

  return {
    transactionBase64: result.transactionXdr,
    sendTo: options?.sendTo,
  };
}

export async function signAndSend(
  transactionXdr: string,
  signTransaction?: (tx: string) => Promise<string>,
  options?: { sendTo?: string; [key: string]: any },
): Promise<string> {
  const srv = getServer();
  const passphrase = await getNetworkPassphrase();

  let txToSubmit = StellarSdk.TransactionBuilder.fromXDR(transactionXdr, passphrase);

  if (signTransaction) {
    const signedXdr = await signTransaction(transactionXdr);
    txToSubmit = StellarSdk.TransactionBuilder.fromXDR(signedXdr, passphrase);
  }

  const result = await srv.sendTransaction(txToSubmit);
  return result.hash;
}
