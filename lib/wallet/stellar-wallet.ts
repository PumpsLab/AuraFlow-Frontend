"use client";

import * as Freighter from "@stellar/freighter-api";

export interface StellarWalletState {
  address: string | null;
  isConnected: boolean;
  network: string;
  networkPassphrase: string;
}

let cachedState: StellarWalletState | null = null;

export async function connectFreighter(): Promise<StellarWalletState> {
  // 1. Check if Freighter is installed (docs: always check isConnected first)
  const connected = await Freighter.isConnected();
  if (connected.error) {
    cachedState = null;
    throw new Error(connected.error.message || "Failed to check Freighter installation");
  }
  if (!connected.isConnected) {
    cachedState = null;
    throw new Error("Freighter is not installed. Please install it from https://freighter.app");
  }

  // 2. Request access - recommended way per docs.freighter.app/extension-freighter-api/connecting
  //    Combines authorization + public key retrieval. Returns immediately if already authorized.
  const access = await Freighter.requestAccess();
  if (access.error) {
    cachedState = null;
    throw new Error(access.error.message || "Freighter access denied. Please approve the connection.");
  }
  if (!access.address) {
    cachedState = null;
    throw new Error("No address returned from Freighter");
  }

  // 3. Get network details - use getNetworkDetails for Soroban RPC URL when available
  const networkDetails = await Freighter.getNetworkDetails().catch(async () => {
    const fallback = await Freighter.getNetwork();
    return { ...fallback, networkUrl: "", sorobanRpcUrl: undefined as string | undefined };
  });

  if ((networkDetails as any).error) {
    cachedState = null;
    throw new Error((networkDetails as any).error.message || "Failed to get network from Freighter");
  }

  cachedState = {
    address: access.address,
    isConnected: true,
    network: networkDetails.network,
    networkPassphrase: networkDetails.networkPassphrase,
  };

  return cachedState;
}

export async function getStellarAddress(): Promise<string | null> {
  if (cachedState?.isConnected && cachedState.address) return cachedState.address;
  try {
    // getAddress is lightweight, does NOT prompt - returns empty string if not authorized
    const result = await Freighter.getAddress();
    if (result.error) return null;
    if (!result.address) return null;

    // Also refresh network if we can
    try {
      const net = await Freighter.getNetwork();
      if (!net.error && net.networkPassphrase) {
        cachedState = {
          address: result.address,
          isConnected: true,
          network: net.network,
          networkPassphrase: net.networkPassphrase,
        };
      } else {
        cachedState = {
          address: result.address,
          isConnected: true,
          network: cachedState?.network || "",
          networkPassphrase: cachedState?.networkPassphrase || "",
        };
      }
    } catch {
      cachedState = {
        address: result.address,
        isConnected: true,
        network: cachedState?.network || "",
        networkPassphrase: cachedState?.networkPassphrase || "",
      };
    }

    return result.address;
  } catch {
    return null;
  }
}

export async function getStellarNetworkPassphrase(): Promise<string> {
  if (cachedState?.networkPassphrase) return cachedState.networkPassphrase;
  try {
    const net = await Freighter.getNetwork();
    if (!net.error && net.networkPassphrase) {
      if (cachedState) cachedState.networkPassphrase = net.networkPassphrase;
      return net.networkPassphrase;
    }
  } catch {}
  // Fallback to env-based default - use TESTNET for testnet, PUBLIC for mainnet
  const { STELLAR_NETWORK_PASSPHRASE } = await import("./contract-config");
  return STELLAR_NETWORK_PASSPHRASE;
}

export async function signStellarMessage(message: string): Promise<string> {
  const address = await getStellarAddress();
  if (!address) throw new Error("Not connected to Freighter");

  // Per docs.freighter.app/extension-freighter-api/signing - signMessage(message, {address})
  // Local d.ts allows opts?: {address?, networkPassphrase?} but docs require address
  const result = await Freighter.signMessage(message, {
    address,
  });

  if (result.error) {
    throw new Error(result.error.message || "Failed to sign message");
  }

  if (!result.signedMessage) {
    throw new Error("No signed message returned from Freighter");
  }

  // signMessage can return Buffer (v3) or string (v4) depending on Freighter version
  return typeof result.signedMessage === "string"
    ? result.signedMessage
    : Buffer.from(result.signedMessage as any).toString("base64");
}

export async function signStellarTransaction(transactionXdr: string): Promise<string> {
  const address = await getStellarAddress();
  const networkPassphrase = await getStellarNetworkPassphrase();

  // Per docs: signTransaction(xdr, {network?, networkPassphrase?, address?})
  // Passing address + networkPassphrase gives user warning if on wrong network
  const result = await Freighter.signTransaction(transactionXdr, {
    address: address || undefined,
    networkPassphrase,
  });

  if (result.error) {
    throw new Error(result.error.message || "Failed to sign transaction");
  }

  if (!result.signedTxXdr) {
    throw new Error("No signed transaction returned from Freighter");
  }

  return result.signedTxXdr;
}

export function disconnectFreighter(): void {
  cachedState = null;
  if (typeof window !== "undefined") {
    try { localStorage.setItem("auraflow-wallet-disconnected", Date.now().toString()); } catch {}
  }
}

export function wasWalletDisconnected(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const ts = localStorage.getItem("auraflow-wallet-disconnected");
    if (!ts) return false;
    localStorage.removeItem("auraflow-wallet-disconnected");
    // Only treat as intentional disconnect if it happened within the last 5 seconds
    return Date.now() - Number(ts) < 5000;
  } catch { return false; }
}

export function getCachedStellarState(): StellarWalletState | null {
  return cachedState;
}
