"use client";

import { ReactNode } from "react";

// Freighter wallet is a browser extension and doesn't require complex provider setup
// This component is kept for API compatibility with the rest of the app

export function WalletProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
