"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/hooks/useWallet";
import {
  FileDown,
  Loader2,
  RefreshCw,
  CheckCircle2,
  Clock3,
  AlertTriangle,
  ExternalLink,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

import { EmployeeLayout } from "@/components/employee-layout";
import { walletAuthenticatedFetch } from "@/lib/wallet/wallet-auth-fetch";

/* ─── Types ─── */

interface PrivateTransferRun {
  id: string;
  date: string;
  mode?: "streaming" | "private_payroll";
  totalAmount: number;
  employeeCount: number;
  employeeIds?: string[];
  employeeNames?: string[];
  recipientAddresses: string[];
  employeeAmounts?: number[];
  status: "success" | "failed" | "submitted";
  transferSig?: string;
  transferSigs?: string[];
  payPeriod?: string;
  privacyConfig?: { memo?: string };
  providerMeta?: {
    transferProofs?: Array<{
      address: string;
      signature: string;
      amount: number;
    }>;
  };
}

interface StatementRow {
  type?: "private_transfer" | "claim" | "employer_settle";
  statementId: string;
  transferSig?: string;
  cycle: {
    id: string;
    label: string;
    periodStart: string;
    periodEnd: string;
    payDate: string;
    status: string;
  };
  payroll: {
    currency: string;
    netPayAmount: number;
    grossAmount: number;
    baseSalaryAmount: number;
    activeDays: number;
    periodDays: number;
  };
  payout: {
    status: "unpaid" | "paid" | "failed" | "queued";
    txSignature?: string;
    paidAt?: string;
  };
}

interface WithdrawalRecord {
  id: string;
  date: string;
  amount: number;
  recipient: string;
  txSig?: string;
  status: "success" | "failed" | "submitted";
  providerMeta?: {
    action?:
      | "employee-withdrawal"
      | "employee-external-transfer"
      | "employee-private-transfer"
      | "claim";
    destinationWallet?: string;
    creditVerified?: boolean;
    errorMessage?: string;
  };
  privacyConfig?: {
    fromBalance?: "base" | "ephemeral";
    toBalance?: "base" | "ephemeral";
  };
}

type HistoryTab = "income" | "withdrawals";

/* ─── Helpers ─── */

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(amount);
}

function getEmployeeStatusLabel(statement: StatementRow) {
  if (statement.type === "private_transfer") {
    return statement.payout.status === "queued" ? "In Transit" : "✓ Received";
  }
  if (statement.type === "employer_settle") {
    return statement.payout.status === "queued" ? "In Transit" : "✓ Settled";
  }
  switch (statement.payout.status) {
    case "paid":
      return "✓ Claimed";
    case "queued":
      return "In Transit";
    case "failed":
      return "Failed";
    case "unpaid":
    default:
      return "Unclaimed";
  }
}

function getEmployeeStatusClass(statement: StatementRow) {
  if (statement.payout.status === "failed") {
    return "border-red-400/30 bg-red-500/15 text-red-300";
  }
  if (statement.payout.status === "queued") {
    return "border-amber-400/30 bg-amber-500/15 text-amber-300";
  }
  if (statement.type === "private_transfer" || statement.payout.status === "paid") {
    return "border-emerald-400/30 bg-emerald-500/15 text-emerald-300";
  }
  return "border-white/10 bg-white/5 text-white";
}

function formatTxSig(value?: string) {
  return value ? `${value.slice(0, 6)}...${value.slice(-6)}` : "Not recorded";
}

/* ─── Component ─── */

export default function ClaimHistoryPage() {
  const { publicKey, signMessage } = useWallet();
  const walletAddr = publicKey;

  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [privateTransfers, setPrivateTransfers] = useState<StatementRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<HistoryTab>("income");

  const downloadPdf = async (statement: StatementRow) => {
    try {
      const element = document.getElementById(`receipt-${statement.statementId}`);
      if (!element) return;
      
      const canvas = await html2canvas(element, { scale: 2 });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${statement.cycle.label.replace(/\s+/g, "_")}_Receipt.pdf`);
      toast.success("Payslip PDF downloaded");
    } catch (error) {
      toast.error("Failed to generate PDF payslip");
    }
  };

  const loadHistory = async (interactive = false) => {
    if (!walletAddr || !signMessage) return;

    if (interactive) {
      setLoading(true);
    }
    try {
      const [statementRes, historyRes] = await Promise.all([
        walletAuthenticatedFetch({
          wallet: walletAddr,
          signMessage,
          path: `/api/v1/payroll-runs/statements?scope=employee&wallet=${walletAddr}`,
        }),
        walletAuthenticatedFetch({
          wallet: walletAddr,
          signMessage,
          path: `/api/v1/history?scope=employee&wallet=${walletAddr}`,
        }),
      ]);

      if (statementRes.ok) {
        const statementJson = await statementRes.json();
        setStatements((statementJson.statements ?? []) as StatementRow[]);
      }

      if (historyRes.ok) {
        const historyJson = await historyRes.json();

        // Private transfer runs (income)
        const runs = (historyJson.payrollRuns ?? []) as PrivateTransferRun[];
        const privateRuns = runs.filter(
          (run) =>
            (run.mode === "private_payroll" || run.mode === "streaming" || !run.mode) &&
            (run.status === "success" || run.status === "submitted") &&
            Array.isArray(run.recipientAddresses) &&
            run.recipientAddresses.includes(walletAddr),
        );

        const transferRows: StatementRow[] = privateRuns.map((run) => {
          const isStreamingSettle = run.mode === "streaming" || !run.mode;
          const idx = run.recipientAddresses?.indexOf(walletAddr) ?? -1;
          const amount =
            idx >= 0 && Array.isArray(run.employeeAmounts)
              ? run.employeeAmounts[idx]
              : run.totalAmount / run.employeeCount;
          const walletProof =
            run.providerMeta?.transferProofs?.find(
              (proof) => proof.address === walletAddr,
            ) ?? null;
          const transferProofSig =
            walletProof?.signature ??
            (idx >= 0 && Array.isArray(run.transferSigs)
              ? run.transferSigs[idx]
              : undefined) ??
            run.transferSig;

          const formatPayPeriod = (period?: string) => {
            if (!period) return null;
            const [year, month] = period.split("-");
            if (!year || !month) return null;
            const date = new Date(parseInt(year), parseInt(month) - 1);
            return `${date.toLocaleString("default", { month: "long" })} ${year} Salary`;
          };

          return {
            type: isStreamingSettle ? "employer_settle" : "private_transfer",
            statementId: `pt-${run.id}`,
            transferSig: transferProofSig,
            cycle: {
              id: `pt-${run.id}`,
              label: formatPayPeriod(run.payPeriod) || run.privacyConfig?.memo || "Private Transfer",
              periodStart: run.date,
              periodEnd: run.date,
              payDate: run.date,
              status: "completed",
            },
            payroll: {
              currency: "USD",
              netPayAmount: amount,
              grossAmount: amount,
              baseSalaryAmount: amount,
              activeDays: 0,
              periodDays: 0,
            },
            payout: {
              status: run.status === "submitted" ? "queued" : "paid",
              txSignature: transferProofSig,
              paidAt: run.date,
            },
          };
        });

        setPrivateTransfers(transferRows);

        // Withdrawal records (claimRecords)
        const claimRecords = (historyJson.claimRecords ?? []) as WithdrawalRecord[];
        
        // Employee claimed salary from streaming
        const salaryClaims = claimRecords.filter(
          (record) => record.providerMeta?.action === "claim"
        );
        const claimRows: StatementRow[] = salaryClaims.map((claim) => ({
          type: "claim",
          statementId: `claim-${claim.id}`,
          transferSig: claim.txSig,
          cycle: {
            id: `claim-${claim.id}`,
            label: "Salary Claim",
            periodStart: claim.date,
            periodEnd: claim.date,
            payDate: claim.date,
            status: claim.status === "success" ? "completed" : "failed",
          },
          payroll: {
            currency: "USD",
            netPayAmount: claim.amount,
            grossAmount: claim.amount,
            baseSalaryAmount: claim.amount,
            activeDays: 0,
            periodDays: 0,
          },
          payout: {
            status: claim.status === "success" ? "paid" : claim.status === "failed" ? "failed" : "queued",
            txSignature: claim.txSig,
            paidAt: claim.date,
          },
        }));

        setPrivateTransfers([...transferRows, ...claimRows]);

        const withdrawalItems = claimRecords.filter((record) =>
          record.providerMeta?.action === "employee-withdrawal" ||
          record.providerMeta?.action === "employee-external-transfer" ||
          record.providerMeta?.action === "employee-private-transfer"
        );
        setWithdrawals(withdrawalItems);
      }
    } catch (error) {
      if (interactive) {
        toast.error("Failed to load statement history");
      }
    } finally {
      if (interactive) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadHistory(true);
  }, [publicKey, signMessage, walletAddr]);

  const allStatements = [...statements, ...privateTransfers].sort(
    (a, b) => new Date(b.cycle.payDate).getTime() - new Date(a.cycle.payDate).getTime(),
  );

  return (
    <EmployeeLayout>
      <div className="mx-auto max-w-6xl px-4 py-2 sm:px-6">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-heading text-4xl font-bold tracking-tight text-white">History</h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-[#a8a8aa]">
              View your past payroll cycles, withdrawals, and download official PDF payslips.
            </p>
          </div>
          <div className="flex w-fit flex-wrap rounded-2xl border border-white/10 bg-white/5 p-1 backdrop-blur-xl">
            <Link href="/claim/dashboard" className="flex h-9 min-w-[108px] items-center justify-center rounded-xl px-4 text-[10px] font-bold uppercase tracking-wider text-[#8f8f95] transition-all hover:bg-white/10 hover:text-white no-underline">
              Dashboard
            </Link>
            <Link href="/claim/balances" className="flex h-9 min-w-[108px] items-center justify-center rounded-xl px-4 text-[10px] font-bold uppercase tracking-wider text-[#8f8f95] transition-all hover:bg-white/10 hover:text-white no-underline">
              Balances
            </Link>
            <Link href="/claim/withdraw" className="flex h-9 min-w-[108px] items-center justify-center rounded-xl px-4 text-[10px] font-bold uppercase tracking-wider text-[#8f8f95] transition-all hover:bg-white/10 hover:text-white no-underline">
              Withdraw
            </Link>
            <button className="h-9 min-w-[108px] rounded-xl bg-[#a855f7] px-4 text-[10px] font-bold uppercase tracking-wider text-black shadow-sm transition-all">
              History
            </button>
          </div>
        </div>

        {/* ─── Tabs ─── */}
        <div className="mb-6 flex items-center gap-1 rounded-2xl border border-white/10 bg-[#0a0a0a] p-1.5 w-fit">
          <button
            onClick={() => setActiveTab("income")}
            className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${
              activeTab === "income"
                ? "bg-[#a855f7] text-black shadow-[0_0_16px_rgba(168,85,247,0.25)]"
                : "text-[#8f8f95] hover:bg-white/5 hover:text-white"
            }`}
          >
            <ArrowDownLeft size={14} />
            Income
            {allStatements.length > 0 && (
              <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                activeTab === "income"
                  ? "bg-black/20 text-black"
                  : "bg-white/10 text-[#a8a8aa]"
              }`}>
                {allStatements.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("withdrawals")}
            className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${
              activeTab === "withdrawals"
                ? "bg-[#a855f7] text-black shadow-[0_0_16px_rgba(168,85,247,0.25)]"
                : "text-[#8f8f95] hover:bg-white/5 hover:text-white"
            }`}
          >
            <ArrowUpRight size={14} />
            Withdrawals
            {withdrawals.length > 0 && (
              <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                activeTab === "withdrawals"
                  ? "bg-black/20 text-black"
                  : "bg-white/10 text-[#a8a8aa]"
              }`}>
                {withdrawals.length}
              </span>
            )}
          </button>
        </div>

        {/* ─── Income Tab ─── */}
        {activeTab === "income" && (
          <div className="bg-[#0a0a0a] border border-white/10 rounded-[2rem] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
              <div>
                <h2 className="text-lg font-bold text-white">Statement History</h2>
                <p className="text-sm text-[#8f8f95] mt-1">
                  Payroll cycles, instant transfers, and delivery status.
                </p>
              </div>
              <button
                onClick={() => void loadHistory(true)}
                disabled={loading}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-[#8f8f95] shadow-sm transition-all hover:border-[#a855f7]/40 hover:text-[#a855f7] disabled:opacity-50"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              </button>
            </div>
            
            <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr_auto] gap-4 px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-[#8f8f95] border-b border-white/10">
              <span>Cycle</span>
              <span>Pay date</span>
              <span>Net pay</span>
              <span>Status</span>
              <span>Type</span>
              <span className="w-8"></span>
            </div>
            
            {loading && allStatements.length === 0 ? (
              <div className="px-6 py-14 flex items-center justify-center">
                <Loader2 className="animate-spin text-[#a855f7]" size={24} />
              </div>
            ) : allStatements.length === 0 ? (
              <div className="px-6 py-14 text-center text-sm text-[#8f8f95]">
                No generated statements yet.
              </div>
            ) : (
              allStatements.map((statement) => (
                <div key={statement.statementId}>
                  <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_1fr_auto] gap-4 px-6 py-4 border-b border-white/5 text-sm items-center">
                    <div>
                      <p className="font-semibold text-white">{statement.cycle.label}</p>
                      <p className="text-xs text-[#8f8f95] mt-1">
                        {statement.type === "private_transfer" || statement.type === "claim" || statement.type === "employer_settle"
                          ? new Date(statement.cycle.payDate).toLocaleDateString()
                          : `${new Date(statement.cycle.periodStart).toLocaleDateString()} - ${new Date(statement.cycle.periodEnd).toLocaleDateString()}`}
                      </p>
                    </div>
                    <span className="text-[#b6b6bc]">{new Date(statement.cycle.payDate).toLocaleDateString()}</span>
                    <span className="font-semibold text-white">{formatCurrency(statement.payroll.netPayAmount)}</span>
                    <span
                      className={`inline-flex items-center w-fit px-2.5 py-1 rounded-lg text-[11px] font-bold border ${getEmployeeStatusClass(statement)}`}
                    >
                      {getEmployeeStatusLabel(statement)}
                    </span>
                    <span className="text-[#b6b6bc]">
                      {statement.type === "private_transfer" ? "Instant" : statement.type === "claim" ? "Claim" : statement.type === "employer_settle" ? "Settlement" : "Streaming"}
                    </span>
                    <button
                      onClick={() => downloadPdf(statement)}
                      className="p-2 text-[#8f8f95] hover:text-white transition-colors ml-auto"
                      title="Download PDF Payslip"
                    >
                      <FileDown size={16} />
                    </button>
                  </div>

                  {/* Hidden PDF Template */}
                  <div className="absolute left-[-9999px] top-[-9999px] opacity-0 pointer-events-none">
                    <div
                      id={`receipt-${statement.statementId}`}
                      className="bg-white p-12 w-[800px] font-sans text-black"
                    >
                      <div className="border-b-2 border-black pb-6 mb-8 flex justify-between items-end">
                        <div>
                          <h1 className="text-4xl font-bold tracking-tight mb-1">AuraFlow Payroll</h1>
                          <p className="text-lg text-gray-500 uppercase tracking-widest font-semibold">
                            Official Payslip
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-500 font-medium">Issue Date</p>
                          <p className="text-lg font-bold">
                            {new Date(statement.cycle.payDate).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-12 mb-12">
                        <div>
                          <p className="text-sm text-gray-500 font-medium uppercase tracking-wider mb-2">
                            Employee Details
                          </p>
                          <p className="text-2xl font-bold">My Wallet</p>
                          <p className="text-sm text-gray-600 mt-1 break-all font-mono">
                            Wallet: {walletAddr}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500 font-medium uppercase tracking-wider mb-2">
                            Payment Details
                          </p>
                          <p className="text-2xl font-bold">{statement.cycle.label}</p>
                          <p className="text-sm text-gray-600 mt-1">
                            Period:{" "}
                            {statement.type === "private_transfer" || statement.type === "claim" || statement.type === "employer_settle"
                              ? new Date(statement.cycle.payDate).toLocaleDateString()
                              : `${new Date(statement.cycle.periodStart).toLocaleDateString()} - ${new Date(statement.cycle.periodEnd).toLocaleDateString()}`}
                          </p>
                            <p className="text-sm text-gray-600 mt-1">
                              Status: {getEmployeeStatusLabel(statement)}
                            </p>
                        </div>
                      </div>

                      <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 mb-12 flex justify-between items-center">
                        <div>
                          <p className="text-sm text-gray-500 font-medium uppercase tracking-wider mb-1">
                            Net Pay Amount
                          </p>
                          <p className="text-5xl font-bold tracking-tight">
                            {formatCurrency(statement.payroll.netPayAmount)}{" "}
                            <span className="text-2xl text-gray-400">USDC</span>
                          </p>
                        </div>
                        <div className="text-right">
                          {(statement.type === "private_transfer" || statement.type === "claim" || statement.type === "employer_settle") && statement.transferSig && (
                            <>
                              <p className="text-sm text-gray-500 font-medium uppercase tracking-wider mb-1">
                                Transaction Ref
                              </p>
                              <p className="text-sm font-mono text-gray-800 bg-gray-200 px-3 py-1.5 rounded-lg">
                                {statement.transferSig.slice(0, 16)}...
                              </p>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="text-center text-sm text-gray-400 mt-24 border-t border-gray-100 pt-8">
                        <p>This is an automatically generated blockchain receipt from AuraFlow.</p>
                        <p>Verify the transaction hash on Stellar Chain for absolute cryptographic proof.</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ─── Withdrawals Tab ─── */}
        {activeTab === "withdrawals" && (
          <div className="bg-[#0a0a0a] border border-white/10 rounded-[2rem] overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
              <div>
                <h2 className="text-lg font-bold text-white">Withdrawal History</h2>
                <p className="text-sm text-[#8f8f95] mt-1">
                  Signed receipts for your base exits and private sends.
                </p>
              </div>
              <button
                onClick={() => void loadHistory(true)}
                disabled={loading}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-[#8f8f95] shadow-sm transition-all hover:border-[#a855f7]/40 hover:text-[#a855f7] disabled:opacity-50"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              </button>
            </div>

            {loading && withdrawals.length === 0 ? (
              <div className="px-6 py-14 flex items-center justify-center">
                <Loader2 className="animate-spin text-[#a855f7]" size={24} />
              </div>
            ) : withdrawals.length === 0 ? (
              <div className="px-6 py-14 text-center text-sm text-[#8f8f95]">
                No withdrawal receipts yet.
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {withdrawals.map((record) => {
                  const isPendingCredit = record.status === "submitted";
                  const isFailed = record.status === "failed";
                  const isExternalTransfer =
                    record.providerMeta?.action === "employee-external-transfer" ||
                    record.providerMeta?.action === "employee-private-transfer";
                  return (
                    <div
                      key={record.id}
                      className="px-6 py-5"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {isPendingCredit ? (
                              <Clock3 size={14} className="text-amber-300" />
                            ) : isFailed ? (
                              <AlertTriangle size={14} className="text-red-300" />
                            ) : (
                              <CheckCircle2 size={14} className="text-[#64f0ce]" />
                            )}
                            <p className="text-sm font-bold text-white">
                              {isExternalTransfer
                                ? "External wallet transfer"
                                : "Base wallet withdrawal"}
                            </p>
                            <span
                              className={`inline-flex rounded-lg border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                                isPendingCredit
                                  ? "border-amber-300/30 bg-amber-400/10 text-amber-200"
                                  : isFailed
                                    ? "border-red-400/30 bg-red-500/10 text-red-200"
                                    : "border-[#a855f7]/20 bg-[#a855f7]/10 text-[#c084fc]"
                              }`}
                            >
                              {record.status}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-[#a8a8aa] break-all">
                            Destination: {record.providerMeta?.destinationWallet ?? record.recipient}
                          </p>
                          <p className="mt-1 text-[11px] text-[#8f8f95]">
                            {new Date(record.date).toLocaleString()}
                          </p>
                          <p className="mt-2 text-[11px] text-[#b6b6bc]">
                            {isPendingCredit
                              ? "Fee may already be spent. The withdrawal transaction was submitted, but the base-wallet credit is not visible yet."
                              : isFailed
                                ? record.providerMeta?.errorMessage ?? "The transaction did not complete."
                                : "Funds were submitted successfully."}
                          </p>
                          <div className="mt-3 flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[#62626b]">
                              TX
                            </span>
                            {record.txSig ? (
                              <a
                                href={`https://stellarchain.io/transactions/${record.txSig}`}
                                target="_blank"
                                rel="noreferrer"
                                className="group inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#a8a8aa] transition-all hover:border-white/20 hover:bg-white/10 hover:text-white"
                              >
                                {formatTxSig(record.txSig)}
                                <ExternalLink size={12} className="opacity-60 group-hover:opacity-100" />
                              </a>
                            ) : (
                              <span className="text-[10px] uppercase tracking-widest text-[#62626b]">
                                Not recorded
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-left sm:text-right">
                          <p className="text-sm font-bold text-white">
                            {record.amount.toFixed(6)} USDC
                          </p>
                          <p className="mt-1 text-[10px] uppercase tracking-widest text-[#8f8f95]">
                            {record.privacyConfig?.fromBalance ?? "ephemeral"} → {record.privacyConfig?.toBalance ?? "unknown"}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </EmployeeLayout>
  );
}
