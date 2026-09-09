"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  connectFreighter,
  getStellarAddress,
  signStellarMessage,
  signStellarTransaction,
  disconnectFreighter,
  wasWalletDisconnected,
  StellarWalletState,
  getCachedStellarState,
} from "@/lib/wallet/stellar-wallet";
import { clearWalletSession } from "@/lib/wallet/wallet-auth-fetch";
import * as Freighter from "@stellar/freighter-api";

export interface Wallet {
  id: string;
  name: string;
  icon?: string;
}

export function useWallet() {
  const [walletState, setWalletState] = useState<StellarWalletState>(() => {
    const cached = getCachedStellarState();
    return cached || { address: null, isConnected: false, network: "", networkPassphrase: "" };
  });
  const [isConnecting, setIsConnecting] = useState(false);

  // Restore session on mount without prompting (per docs: getAddress does NOT prompt)
  // Skip if user just disconnected — they must re-authorize via Freighter popup
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (wasWalletDisconnected()) return;
      try {
        const connected = await Freighter.isConnected();
        if (connected.error || !connected.isConnected) return;
        const addrRes = await Freighter.getAddress();
        if (addrRes.error || !addrRes.address) return;
        const netRes = await Freighter.getNetwork();
        if (netRes.error) return;
        if (!cancelled) {
          setWalletState({
            address: addrRes.address,
            isConnected: true,
            network: netRes.network,
            networkPassphrase: netRes.networkPassphrase,
          });
        }
      } catch {
        // not connected, ignore
      }
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Watch for wallet changes (account / network switch)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const watcher = new Freighter.WatchWalletChanges(3000);
      watcher.watch((data: { address: string; network: string; networkPassphrase: string; error?: unknown }) => {
        if (data.error) return;
        // If address empty, treat as disconnected
        if (!data.address) {
          setWalletState({ address: null, isConnected: false, network: "", networkPassphrase: "" });
          return;
        }
        setWalletState({
          address: data.address,
          isConnected: true,
          network: data.network,
          networkPassphrase: data.networkPassphrase,
        });
      });
      return () => watcher.stop();
    } catch {
      return;
    }
  }, []);

  const truncated = useMemo(() => {
    if (!walletState.address) return null;
    return `${walletState.address.slice(0, 6)}...${walletState.address.slice(-4)}`;
  }, [walletState.address]);

  const connectFn = useCallback(async () => {
    setIsConnecting(true);
    try {
      const state = await connectFreighter();
      setWalletState(state);
    } catch (error) {
      console.error("Failed to connect Freighter:", error);
      // Re-throw so UI can show error, avoid alert() which blocks
      throw error;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnectFn = useCallback(() => {
    if (walletState.address) {
      clearWalletSession(walletState.address);
    }
    disconnectFreighter();
    window.location.reload();
  }, [walletState.address]);

  const signMessageFn = useCallback(async (message: string | Uint8Array) => {
    const msgStr = typeof message === "string" ? message : new TextDecoder().decode(message);
    return await signStellarMessage(msgStr);
  }, []);

  const signTransactionFn = useCallback(async (tx: string) => {
    return await signStellarTransaction(tx);
  }, []);

  return useMemo(
    () => ({
      connected: walletState.isConnected,
      connecting: isConnecting,
      publicKey: walletState.address || null,
      truncated,
      network: walletState.network || null,
      networkPassphrase: walletState.networkPassphrase || null,
      connect: connectFn,
      disconnect: disconnectFn,
      wallets: [] as Wallet[],
      activeWallet: null,
      selectAndConnect: (_walletId?: string) => connectFn(),
      signMessage: signMessageFn,
      signTransaction: signTransactionFn,
    }),
    [
      walletState.isConnected,
      walletState.address,
      walletState.network,
      walletState.networkPassphrase,
      isConnecting,
      truncated,
      connectFn,
      disconnectFn,
      signMessageFn,
      signTransactionFn,
    ]
  );
}
