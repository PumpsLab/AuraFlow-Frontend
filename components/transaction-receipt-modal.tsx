"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, Download, ExternalLink, ShieldCheck, Receipt } from "lucide-react";

export interface ReceiptData {
  type: "private_transfer" | "withdrawal" | "stream_started" | "salary_claimed";
  amount: number;
  recipientName: string;
  recipientWallet: string;
  date: Date;
  txHash?: string;
  companyName?: string;
}

interface TransactionReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  receiptData: ReceiptData | null;
}

export function TransactionReceiptModal({ isOpen, onClose, receiptData }: TransactionReceiptModalProps) {
  if (!receiptData) return null;

  const formatCurrency = (val: number) => {
    const absolute = Math.abs(val);
    const digits = absolute > 0 && absolute < 0.01 ? 6 : 2;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(val);
  };

  const getTitle = () => {
    switch (receiptData.type) {
      case "private_transfer": return "Private Transfer Sent";
      case "withdrawal": return "Salary Withdrawn";
      case "stream_started": return "Streaming Initialized";
      case "salary_claimed": return "Salary Claimed";
      default: return "Transaction Receipt";
    }
  };

  const handleDownload = () => {
    // In a real app, this would trigger a PDF generation or canvas screenshot.
    // For now, we simulate a download action.
    alert("Receipt downloaded successfully (simulated).");
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-[#0a0a0a] border border-white/10 shadow-2xl"
          >
            {/* Header */}
            <div className="bg-[#a855f7]/10 p-6 flex flex-col items-center justify-center border-b border-white/5 relative">
              <button 
                onClick={onClose}
                className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
              
              <div className="h-12 w-12 rounded-full bg-[#a855f7]/20 flex items-center justify-center mb-4">
                <CheckCircle2 size={24} className="text-[#a855f7]" />
              </div>
              <h2 className="text-white font-bold text-lg mb-1">{getTitle()}</h2>
              <p className="text-3xl font-mono font-bold text-[#a855f7]">
                {formatCurrency(receiptData.amount)} <span className="text-sm font-sans text-[#a855f7]/60">USDC</span>
              </p>
            </div>

            {/* Receipt Body */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Receipt size={16} className="text-[#8f8f95]" />
                  <span className="text-xs font-bold uppercase tracking-widest text-[#8f8f95]">Digital Pay Stub</span>
                </div>
                <span className="text-xs font-mono text-[#8f8f95]">
                  {receiptData.date.toLocaleDateString()}
                </span>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-white/5 border-dashed">
                  <span className="text-sm text-[#8f8f95]">Recipient</span>
                  <span className="text-sm font-semibold text-white">{receiptData.recipientName}</span>
                </div>
                
                <div className="flex justify-between items-center py-2 border-b border-white/5 border-dashed">
                  <span className="text-sm text-[#8f8f95]">Wallet</span>
                  <span className="text-sm font-mono text-white/80">
                    {receiptData.recipientWallet.slice(0, 6)}...{receiptData.recipientWallet.slice(-4)}
                  </span>
                </div>

                <div className="flex justify-between items-center py-2 border-b border-white/5 border-dashed">
                  <span className="text-sm text-[#8f8f95]">Time</span>
                  <span className="text-sm font-mono text-white/80">
                    {receiptData.date.toLocaleTimeString()}
                  </span>
                </div>

                {receiptData.companyName && (
                  <div className="flex justify-between items-center py-2 border-b border-white/5 border-dashed">
                    <span className="text-sm text-[#8f8f95]">Sender</span>
                    <span className="text-sm font-semibold text-white">{receiptData.companyName}</span>
                  </div>
                )}
              </div>

              {receiptData.txHash && (
                <div className="mt-6 rounded-xl bg-white/5 p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 text-xs text-[#8f8f95]">
                    <ShieldCheck size={14} className="text-[#a855f7]" />
                    <span>Cryptographically verified</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-white/40 truncate mr-2">
                      {receiptData.txHash}
                    </span>
                    <a 
                      href={`https://stellarchain.io/transactions/${receiptData.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#a855f7] hover:text-[#c084fc] flex items-center gap-1 flex-shrink-0"
                    >
                      Explorer <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="mt-8 flex gap-3">
                <button
                  onClick={handleDownload}
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 py-3 flex items-center justify-center gap-2 text-sm font-semibold text-white hover:bg-white/10 transition-colors"
                >
                  <Download size={16} /> Download
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 rounded-xl bg-[#a855f7] text-black py-3 flex items-center justify-center text-sm font-bold hover:bg-[#c084fc] transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
