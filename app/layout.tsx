import type { Metadata } from "next";

import "./globals.css";
import { WalletProvider } from "@/components/wallet-provider";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "AuraFlow — Privacy-First Payroll for Stellar",
  description:
    "Run payroll with complete financial privacy. Per-second streaming, private settlements, and complete salary confidentiality on Stellar.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="min-h-full flex flex-col relative bg-black text-white"
      >
        <WalletProvider>
          {children}
          <Toaster position="bottom-right" theme="dark" />
        </WalletProvider>
      </body>
    </html>
  );
}
