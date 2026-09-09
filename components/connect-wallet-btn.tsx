"use client";

import { useState, useRef, useEffect } from "react";
import {
  ChevronDown,
  Check,
  Copy,
  Wallet,
  Menu,
  LogOut,
  X,
} from "lucide-react";
import { useWallet } from "@/hooks/useWallet";

export interface ConnectWalletBtnProps {
  menuOpen?: boolean;
  onMenuToggle?: (open: boolean) => void;
  className?: string;
  mode?: "nav" | "standalone";
}

export function ConnectWalletBtn({
  menuOpen = false,
  onMenuToggle,
  className = "",
  mode = "nav",
}: ConnectWalletBtnProps) {
  const { connected, publicKey, disconnect, truncated, connect } =
    useWallet();

  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setAccountDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const openConnectModal = () => {
    setAccountDropdownOpen(false);
    connect();
  };

  const handleCopy = async () => {
    if (publicKey) {
      try {
        await navigator.clipboard.writeText(publicKey);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 1500);
      } catch {
        // Copy failed silently
      }
    }
  };

  const isStandalone = mode === "standalone";

  return (
    <>
      <div className={`flex items-center gap-2.5 ${className}`}>
        {connected ? (
          <div
            className={`${isStandalone ? "block" : "hidden md:block"} relative z-50`}
            ref={dropdownRef}
          >
            <button
              onClick={() => setAccountDropdownOpen(!accountDropdownOpen)}
              className="flex items-center gap-2 pl-2 pr-3 py-2 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition-all duration-200 cursor-pointer shadow-sm"
            >
              <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#a855f7]/20 shrink-0">
                <Wallet size={16} className="text-[#a855f7]" />
              </span>
              <span className="font-mono text-[12px] tracking-wide text-white">
                {truncated}
              </span>
              <ChevronDown
                size={13}
                className={`text-gray-400 transition-transform duration-200 ${accountDropdownOpen ? "rotate-180" : ""
                  }`}
              />
            </button>

            {accountDropdownOpen && (
              <div
                className="absolute right-0 top-[calc(100%+10px)] w-60 rounded-2xl border border-white/10 bg-[#0a0a0a]/95 backdrop-blur-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top-right z-[100]"
                role="menu"
              >
                <div className="flex flex-col items-center gap-3 px-4 pt-5 pb-4 bg-[#0a0a0a] border-b border-white/10">
                  <div className="flex items-center justify-center w-12 h-12 rounded-2xl overflow-hidden border border-white/10 shrink-0 bg-white/5">
                    <Wallet size={20} className="text-[#a8a8aa]" />
                  </div>
                  <button
                    onClick={handleCopy}
                    aria-label="Copy address"
                    className="flex items-center justify-between gap-2 w-full px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition-all duration-150 cursor-pointer border border-white/10"
                  >
                    <span className="font-mono text-[12px] tracking-wider text-white">
                      {truncated}
                    </span>
                    {isCopied ? (
                      <Check size={13} className="text-[#a855f7] shrink-0" />
                    ) : (
                      <Copy size={13} className="text-[#a8a8aa] shrink-0" />
                    )}
                  </button>
                </div>

                <div className="p-2 bg-[#0a0a0a]">
                  <button
                    role="menuitem"
                    onClick={openConnectModal}
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium text-[#a8a8aa] hover:text-white hover:bg-white/5 transition-all duration-150 cursor-pointer"
                  >
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 shrink-0">
                      <Wallet size={14} className="text-[#a8a8aa]" />
                    </span>
                    Change Wallet
                  </button>

                  <div className="h-px bg-white/10 mx-2 my-1.5" />

                  <button
                    role="menuitem"
                    onClick={() => {
                      setAccountDropdownOpen(false);
                      disconnect();
                    }}
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-[13px] font-medium text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150 cursor-pointer"
                  >
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/10 shrink-0">
                      <LogOut size={14} className="text-red-400" />
                    </span>
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Disconnected state ── */
          <button
            onClick={openConnectModal}
            aria-label="Connect wallet"
            className={`${isStandalone ? "inline-flex w-full justify-center py-3 rounded-xl" : "hidden md:flex px-6 py-2.5 rounded-full"} items-center gap-2.5 bg-[#a855f7] hover:bg-[#a855f7]/80 active:scale-[0.98] text-black text-[13.5px] font-bold tracking-tight transition-all duration-200 cursor-pointer shadow-sm`}
          >
            <Wallet size={16} />
            Connect Wallet
          </button>
        )}

        {!isStandalone && (
          <button
            onClick={() => onMenuToggle?.(!menuOpen)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-xl bg-white/5 border border-white/10 text-[#a8a8aa] hover:text-white hover:bg-white/10 transition-all duration-150 cursor-pointer shadow-sm"
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        )}
      </div>
    </>
  );
}

