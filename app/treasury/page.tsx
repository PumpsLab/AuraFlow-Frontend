"use client";

import { Suspense, useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, Landmark, TrendingUp, Zap, Users, RefreshCw, Plus, ArrowDownLeft, ArrowUpRight, History, CalendarDays, CheckCircle2, XCircle, Search, Calendar, ShieldCheck, Clock, Download, ArrowUpFromLine } from "lucide-react";
import { EmployerLayout } from "@/components/employer-layout";
import { walletAuthenticatedFetch } from "@/lib/wallet/wallet-auth-fetch";
import { DepositModal } from "@/components/deposit-modal";
import { WithdrawModal } from "@/components/withdraw-modal";
import { AuditorModal } from "@/components/auditor-modal";
import { getPrivateBalance, getBalance, fetchTeeAuthToken, isJwtExpired } from "@/lib/private-payroll-api";
import { getOrCreateCachedTeeToken, loadCachedTeeToken, clearCachedTeeToken } from "@/lib/tee-auth-cache";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { toast } from "sonner";
import { drainPendingHistory, getPendingHistoryCount } from "@/lib/history-queue";

interface StreamInfo { id: string; status: "active" | "paused" | "stopped" | "pending"; ratePerSecond: number; totalPaid: number; accruedUnpaid: number; }
interface SetupAction { id: string; type: "initialize-mint" | "fund-treasury"; date: string; amount?: number; txSig?: string; status: "success" | "failed"; }
interface PayrollRun {
  id: string;
  date: string;
  mode?: "streaming" | "private_payroll";
  payPeriod?: string;
  totalAmount: number;
  employeeCount: number;
  employeeNames?: string[];
  recipientAddresses?: string[];
  depositSig?: string;
  transferSig?: string;
  status: "success" | "failed";
  providerMeta?: {
    action?: string;
  };
}
interface ClaimRecord { id: string; date: string; amount: number; recipient: string; txSig?: string; status: "success" | "failed"; }

type Transaction = {
  id: string;
  date: string;
  type: "Private Vault Deposit" | "Treasury Withdrawal" | "Payroll Disbursement" | "Employee Claim";
  amount: number;
  status: "success" | "failed";
  meta: string;
  txSig?: string;
  payrollMode?: "streaming" | "private_payroll";
};

function resolvePayrollRunMode(
  run: PayrollRun,
): "streaming" | "private_payroll" {
  if (run.mode === "private_payroll") return "private_payroll";
  if (run.mode === "streaming") return "streaming";
  if (run.providerMeta?.action === "employee-private-transfer") {
    return "private_payroll";
  }
  if (typeof run.payPeriod === "string" && run.payPeriod.trim().length > 0) {
    return "private_payroll";
  }
  return "streaming";
}

function TreasuryPageContent() {
  const { publicKey, signMessage } = useWallet();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [baseBalance, setBaseBalance] = useState<number>(0);
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [auditorModalOpen, setAuditorModalOpen] = useState(false);

  const [setupActions, setSetupActions] = useState<SetupAction[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [claimRecords, setClaimRecords] = useState<ClaimRecord[]>([]);
  const [employees, setEmployees] = useState<{wallet: string, name: string}[]>([]);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const hasShownHistoryErrorRef = useRef(false);
  const [pendingHistoryCount, setPendingHistoryCount] = useState(0);

  const [filterTab, setFilterTab] = useState<"All" | "Deposits" | "Payouts">("All");
  const [payrollModeFilter, setPayrollModeFilter] = useState<"All" | "Streaming" | "Private Payroll">("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [chartRange, setChartRange] = useState<"24H" | "7D" | "30D" | "All">("30D");

  const [company, setCompany] = useState<{ id: string; name: string; treasuryPubkey: string } | null>(null);
  const companyRef = useRef(company);
  companyRef.current = company;

  const walletAddr = publicKey || undefined;
  const tokenCache = useRef<string | null>(null);
  const depositIntent = searchParams.get("deposit") === "1";

  const getOrFetchToken = useCallback(async () => {
    if (tokenCache.current && !isJwtExpired(tokenCache.current)) return tokenCache.current;
    if (tokenCache.current && isJwtExpired(tokenCache.current)) {
      tokenCache.current = null;
      if (publicKey) clearCachedTeeToken(publicKey);
    }
    if (!tokenCache.current && publicKey) {
      const persisted = loadCachedTeeToken(publicKey);
      if (persisted) { tokenCache.current = persisted; return persisted; }
    }
    if (!publicKey || !signMessage) throw new Error("Wallet does not support message signing");
    const token = await getOrCreateCachedTeeToken(publicKey, async () => fetchTeeAuthToken(publicKey, signMessage));
    tokenCache.current = token;
    return token;
  }, [publicKey, signMessage]);

  const fetchData = useCallback(async () => {
    if (!walletAddr || !signMessage || !publicKey) return;
    setLoading(true);
    try {
      setHistoryLoadError(null);
      hasShownHistoryErrorRef.current = false;

      // Best-effort: if we have any queued history writes (from deposits when the
      // history API was temporarily unavailable), try to flush them first.
      const queuedCount = getPendingHistoryCount(walletAddr);
      setPendingHistoryCount(queuedCount);
      if (queuedCount > 0) {
        await drainPendingHistory({ wallet: walletAddr, signMessage }).catch(() => undefined);
        setPendingHistoryCount(getPendingHistoryCount(walletAddr));
      }

      // 1. Fetch company data first
      let currentCompany = companyRef.current;
      if (!currentCompany) {
        const cRes = await walletAuthenticatedFetch({
          path: `/api/v1/companies/me?employerWallet=${walletAddr}`,
          method: "GET",
          signMessage,
          wallet: walletAddr,
        });
        if (cRes.ok) {
          const cData = await cRes.json();
          if (cData.company) {
            setCompany(cData.company);
            currentCompany = cData.company;
          }
        }
      }

      // 2. Fetch parallel data
      const [baseBalRes, streamsRes, historyRes, employeesRes] = await Promise.all([
        getBalance(walletAddr).catch(() => null),
        walletAuthenticatedFetch({ path: `/api/v1/streams?employerWallet=${walletAddr}`, method: "GET", signMessage, wallet: walletAddr }),
        walletAuthenticatedFetch({ path: `/api/v1/history?wallet=${walletAddr}`, method: "GET", signMessage, wallet: walletAddr }),
        walletAuthenticatedFetch({ path: `/api/v1/employees?employerWallet=${walletAddr}`, method: "GET", signMessage, wallet: walletAddr })
      ]);

      if (baseBalRes) {
        setBaseBalance(parseInt(baseBalRes.balance ?? "0", 10) / 1_000_000);
      }

      // 3. Fetch private balance depending on if we have a company
      if (currentCompany?.id) {
        const treasuryRes = await walletAuthenticatedFetch({
          path: `/api/v1/companies/${currentCompany.id}/balance?wallet=${walletAddr}`,
          method: "GET",
          signMessage,
          wallet: walletAddr,
        }).catch(() => null);
        if (treasuryRes && treasuryRes.ok) {
          const data = await treasuryRes.json();
          const raw = typeof data.balance === "string" ? data.balance : (data.balance?.usdc ?? "0");
          setBalance(parseFloat(String(raw)) || 0);
        }
      } else {
        const teeToken = await getOrFetchToken();
        const privBalRes = await getPrivateBalance(walletAddr, teeToken).catch(() => null);
        if (privBalRes) {
          setBalance(parseInt(privBalRes.balance ?? "0", 10) / 1_000_000);
        }
      }

      if (streamsRes.ok) {
        const s = await streamsRes.json();
        setStreams(s.streams ?? []);
      }
      if (historyRes.ok) {
        const h = await historyRes.json();
        setSetupActions(h.setupActions ?? []);
        setPayrollRuns(h.payrollRuns ?? []);
        setClaimRecords(h.claimRecords ?? []);
      } else {
        const err = await historyRes
          .json()
          .catch(() => ({ error: "Failed to load history" })) as { error?: string };
        const message = err.error || "Failed to load history";
        setHistoryLoadError(message);
        if (!hasShownHistoryErrorRef.current) {
          hasShownHistoryErrorRef.current = true;
          toast.warning(`History/analytics unavailable: ${message}`);
        }
      }
      if (employeesRes.ok) {
        const e = await employeesRes.json();
        setEmployees(e.employeeProfiles?.map((p: any) => ({ wallet: p.employee.wallet, name: p.employee.name })) ?? []);
      }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [walletAddr, signMessage, publicKey, getOrFetchToken]);

  const getEmployeeName = (walletAddress: string) => {
    const emp = employees.find(e => e.wallet === walletAddress);
    return emp ? emp.name : `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  };

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!depositIntent) return;
    if (!publicKey || !company) return;

    setDepositOpen(true);
    router.replace("/treasury");
  }, [company, depositIntent, publicKey, router]);

  const active = streams.filter((s) => s.status === "active");
  const totalAccrued = streams.reduce((sum, s) => sum + s.accruedUnpaid, 0);
  const totalStreamPaid = streams.reduce((sum, s) => sum + s.totalPaid, 0);
  const dailyBurn = active.reduce((sum, s) => sum + s.ratePerSecond * 86400, 0);

  const totalPrivateTransferPaid = useMemo(
    () =>
      payrollRuns.reduce((sum, run) => {
        const isPrivateTransfer = resolvePayrollRunMode(run) === "private_payroll";
        const isSuccessful = run.status === "success";
        if (!isPrivateTransfer || !isSuccessful) return sum;
        return sum + (Number.isFinite(run.totalAmount) ? run.totalAmount : 0);
      }, 0),
    [payrollRuns],
  );

  const totalPaid = totalStreamPaid + totalPrivateTransferPaid;

  const verifiedSetupActions = useMemo(
    () =>
      setupActions.filter(
        (action) =>
          (action.type === "fund-treasury" || (action as any).type === "treasury-withdraw") &&
          action.status === "success" &&
          typeof action.txSig === "string" &&
          action.txSig.trim().length > 0,
      ),
    [setupActions],
  );

  const transactions: Transaction[] = [
    ...verifiedSetupActions.map(a => ({
      id: a.id,
      date: a.date,
      type: ((a as any).type === "treasury-withdraw" ? "Treasury Withdrawal" : "Private Vault Deposit") as Transaction["type"],
      amount: (a as any).type === "treasury-withdraw" ? -(a.amount || 0) : (a.amount || 0),
      status: a.status,
      meta: (a as any).type === "treasury-withdraw" ? "To Base Wallet" : "From Base Wallet",
      txSig: a.txSig
    })),
    ...payrollRuns.map(a => ({
      id: a.id,
      date: a.date,
      type: "Payroll Disbursement" as const,
      amount: a.totalAmount,
      status: a.status,
      meta: a.employeeNames && a.employeeNames.length > 0
        ? a.employeeNames.join(", ")
        : a.recipientAddresses && a.recipientAddresses.length === 1 
        ? getEmployeeName(a.recipientAddresses[0])
        : `${a.employeeCount} ${a.employeeCount === 1 ? 'Employee' : 'Employees'}`,
      txSig: a.depositSig || a.transferSig,
      payrollMode: resolvePayrollRunMode(a) as
        | "streaming"
        | "private_payroll",
    })),
    ...claimRecords.map(a => ({
      id: a.id,
      date: a.date,
      type: "Employee Claim" as const,
      amount: a.amount,
      status: a.status,
      meta: getEmployeeName(a.recipient),
      txSig: a.txSig
    }))
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (filterTab === "Deposits" && t.type !== "Private Vault Deposit") return false;
      if (filterTab === "Payouts" && t.type !== "Payroll Disbursement" && t.type !== "Employee Claim") return false;
      if (payrollModeFilter !== "All" && t.type === "Payroll Disbursement") {
        const targetMode =
          payrollModeFilter === "Private Payroll" ? "private_payroll" : "streaming";
        if ((t.payrollMode ?? "streaming") !== targetMode) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          t.type.toLowerCase().includes(q) ||
          t.meta.toLowerCase().includes(q) ||
          t.amount.toString().includes(q) ||
          (t.txSig && t.txSig.toLowerCase().includes(q)) ||
          new Date(t.date).toLocaleDateString().toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [filterTab, payrollModeFilter, searchQuery, transactions]);

  const trackedDeposited = verifiedSetupActions
    .reduce((sum, action) => sum + (action.amount || 0), 0);

  const handleExportCSV = () => {
    if (filteredTransactions.length === 0) {
      toast.error("No transactions to export");
      return;
    }

    const headers = ["Date", "Type", "Recipient/Info", "Amount (USDC)", "Status", "Transaction Signature"];
    
    const csvContent = [
      headers.join(","),
      ...filteredTransactions.map(t => {
        return [
          new Date(t.date).toISOString(),
          t.type,
          `"${t.meta.replace(/"/g, '""')}"`,
          t.amount,
          t.status,
          t.txSig || ""
        ].join(",");
      })
    ].join("\\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    const modeSuffix =
      payrollModeFilter === "All"
        ? "all"
        : payrollModeFilter === "Private Payroll"
          ? "private-payroll"
          : "streaming";
    link.setAttribute("download", `auraflow_treasury_${modeSuffix}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Ledger exported to CSV");
  };

  const successfulVolumeTransactions = useMemo(
    () =>
      transactions.filter(
        (tx) =>
          tx.status === "success" &&
          Number.isFinite(tx.amount) &&
          tx.amount > 0 &&
          (tx.type === "Private Vault Deposit" ||
            tx.type === "Payroll Disbursement" ||
            tx.type === "Employee Claim"),
      ),
    [transactions],
  );

  // Analytics Data — dynamic range
  const allTxDates = useMemo(() => {
    const items = successfulVolumeTransactions.map((tx) => ({
      date: tx.date,
      amount: tx.amount,
    }));
    return items;
  }, [successfulVolumeTransactions]);

  const volumeData = useMemo(() => {
    const now = new Date();

    if (chartRange === "24H") {
      // Group by hour, last 24 hours
      const result = Array.from({ length: 24 }, (_, i) => {
        const h = new Date(now);
        h.setHours(now.getHours() - 23 + i, 0, 0, 0);
        return { name: `${h.getHours().toString().padStart(2, '0')}:00`, total: 0, _ts: h.getTime() };
      });
      const cutoff = new Date(now);
      cutoff.setHours(cutoff.getHours() - 24);
      allTxDates.filter(tx => new Date(tx.date) >= cutoff).forEach(tx => {
        const txH = new Date(tx.date).getHours();
        const slot = result.find(r => r.name === `${txH.toString().padStart(2, '0')}:00`);
        if (slot) slot.total += tx.amount;
      });
      return result.map(({ name, total }) => ({ name, total }));
    }

    if (chartRange === "7D") {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const result = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now);
        d.setDate(now.getDate() - 6 + i);
        return { name: `${days[d.getDay()]}`, total: 0, _date: d.toDateString() };
      });
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 7);
      allTxDates.filter(tx => new Date(tx.date) >= cutoff).forEach(tx => {
        const txDate = new Date(tx.date).toDateString();
        const slot = result.find(r => r._date === txDate);
        if (slot) slot.total += tx.amount;
      });
      return result.map(({ name, total }) => ({ name, total }));
    }

    if (chartRange === "30D") {
      const result = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(now);
        d.setDate(now.getDate() - 29 + i);
        return { name: `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`, total: 0, _date: d.toDateString() };
      });
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 30);
      allTxDates.filter(tx => new Date(tx.date) >= cutoff).forEach(tx => {
        const txDate = new Date(tx.date).toDateString();
        const slot = result.find(r => r._date === txDate);
        if (slot) slot.total += tx.amount;
      });
      return result.map(({ name, total }) => ({ name, total }));
    }

    // All — group by month (last 6)
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const result = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now);
      d.setMonth(now.getMonth() - 5 + i);
      return { name: months[d.getMonth()], total: 0 };
    });
    allTxDates.forEach(tx => {
      const mName = months[new Date(tx.date).getMonth()];
      const slot = result.find(r => r.name === mName);
      if (slot) slot.total += tx.amount;
    });
    return result;
  }, [chartRange, allTxDates]);

  const distributionData = useMemo(() => {
    const depositsTotal = successfulVolumeTransactions
      .filter((tx) => tx.type === "Private Vault Deposit")
      .reduce((sum, tx) => sum + tx.amount, 0);

    const streamingTotal = successfulVolumeTransactions
      .filter(
        (tx) =>
          tx.type === "Payroll Disbursement" &&
          (tx.payrollMode ?? "streaming") === "streaming",
      )
      .reduce((sum, tx) => sum + tx.amount, 0);

    const transferTotal = successfulVolumeTransactions
      .filter(
        (tx) =>
          tx.type === "Payroll Disbursement" &&
          tx.payrollMode === "private_payroll",
      )
      .reduce((sum, tx) => sum + tx.amount, 0);

    const claimsTotal = successfulVolumeTransactions
      .filter((tx) => tx.type === "Employee Claim")
      .reduce((sum, tx) => sum + tx.amount, 0);

    return [
      { name: "Deposits", value: depositsTotal, color: "#a855f7" },
      { name: "Streaming", value: streamingTotal, color: "#3b82f6" },
      { name: "Transfers", value: transferTotal, color: "#8b5cf6" },
      { name: "Claims", value: claimsTotal, color: "#3b3b3b" },
    ].filter(d => d.value > 0);
  }, [successfulVolumeTransactions]);

  const formatChartAmount = useCallback((value: number) => {
    if (!Number.isFinite(value)) return "$0";
    if (value >= 1000) return `$${Math.round(value).toLocaleString()}`;
    if (value >= 1) return `$${value.toFixed(2)}`;
    if (value === 0) return "$0";
    return `$${value.toFixed(6)}`;
  }, []);

  const formatTxAmount = useCallback((value: number) => {
    if (!Number.isFinite(value)) return "0.00";
    const abs = Math.abs(value);
    if (abs === 0) return "0.00";
    if (abs >= 1) {
      return abs.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    if (abs >= 0.01) {
      return abs.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      });
    }
    return abs.toLocaleString(undefined, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 6,
    });
  }, []);

  return (
    <EmployerLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        {historyLoadError ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            History/analytics are currently unavailable for this wallet. {historyLoadError}
          </div>
        ) : null}
        {!historyLoadError && pendingHistoryCount > 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-[#a8a8aa]">
            Syncing {pendingHistoryCount} pending deposit record(s) into history...
          </div>
        ) : null}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">History & Analytics</h1>
            <p className="text-sm text-[#a8a8aa] mt-1">
              View and export your premium transaction history.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void fetchData()}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-[#0a0a0a] p-3 text-white transition-colors hover:bg-white/5 disabled:opacity-40 shadow-sm h-[44px] w-[44px]"
              title="Refresh Data"
            >
              {loading ? <Loader2 size={18} className="animate-spin text-[#a8a8aa]" /> : <RefreshCw size={18} className="text-[#a8a8aa]" />}
            </button>
            <button
              onClick={() => setWithdrawOpen(true)}
              className="inline-flex h-[44px] items-center gap-2 rounded-2xl border border-white/10 bg-[#0a0a0a] px-5 text-sm font-semibold text-white transition-colors hover:bg-white/5 shadow-sm"
            >
              <ArrowUpFromLine size={16} className="text-[#a8a8aa]" />
              Withdraw
            </button>
            <button
              onClick={() => setDepositOpen(true)}
              className="inline-flex h-[44px] items-center gap-2 rounded-2xl bg-[#a855f7] px-5 text-sm font-semibold text-black transition-colors hover:bg-[#a855f7]/80 shadow-[0_0_20px_rgba(168,85,247,0.3)]"
            >
              <Plus size={16} />
              Deposit
            </button>
          </div>
        </div>

        <DepositModal
          isOpen={depositOpen}
          onClose={() => setDepositOpen(false)}
          baseBalance={baseBalance}
          privateBalance={balance ?? 0}
          treasuryPubkey={company?.treasuryPubkey}
          companyId={company?.id}
          onDepositSuccess={() => { void fetchData(); }}
        />

        <WithdrawModal
          isOpen={withdrawOpen}
          onClose={() => setWithdrawOpen(false)}
          baseBalance={baseBalance}
          privateBalance={balance ?? 0}
          treasuryPubkey={company?.treasuryPubkey}
          companyId={company?.id}
          onWithdrawSuccess={() => { void fetchData(); }}
        />

        <AuditorModal
          isOpen={auditorModalOpen}
          onClose={() => setAuditorModalOpen(false)}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6 relative">
          {loading && (
            <div className="absolute inset-0 backdrop-blur-[2px] bg-[#0a0a0a]/60 rounded-3xl flex items-center justify-center z-10">
              <Loader2 size={20} className="animate-spin text-[#a855f7]" />
            </div>
          )}
          <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 shadow-sm relative overflow-hidden">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a8a8aa]">Total Payouts</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-white">{totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC</p>
            <p className="mt-1 text-xs text-[#a8a8aa]">All-time streaming + private transfer volume</p>
            <div className="absolute top-5 right-5 text-[#8f8f95]">
              <ArrowUpRight size={20} />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 shadow-sm relative overflow-hidden">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a8a8aa]">Total Deposited</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-white">{trackedDeposited.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC</p>
            <p className="mt-1 text-xs text-[#a8a8aa]">Funds added to private vault (verified tx history)</p>
            <div className="absolute top-5 right-5 text-[#a855f7]">
              <ArrowDownLeft size={20} />
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a8a8aa]">Transactions</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-white">{transactions.length}</p>
            <p className="mt-1 text-xs text-[#a8a8aa]">Total ledger events</p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a8a8aa]">On-Chain Privacy</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-white">
              {transactions.length > 0 ? ((transactions.filter(t => t.txSig).length / transactions.length) * 100).toFixed(1) : "0.0"}%
            </p>
            <p className="mt-1 text-xs text-[#a8a8aa]">{transactions.filter(t => t.txSig).length} of {transactions.length} verified</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-[#0a0a0a] rounded-3xl p-8 shadow-sm border border-white/5">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold text-white">Treasury Volume</h3>
              <div className="flex gap-1">
                {(["24H", "7D", "30D", "All"] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setChartRange(r)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${chartRange === r ? "text-[#a855f7] bg-[#a855f7]/10" : "text-[#555] hover:text-[#8f8f95]"
                      }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-[#8f8f95] mb-6">
              {chartRange === "24H" ? "Hourly" : chartRange === "7D" ? "Daily (7 days)" : chartRange === "30D" ? "Daily (30 days)" : "Monthly"} volume (USDC), including deposits, streaming, and private transfers
            </p>
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={volumeData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8f8f95" }} dy={10} interval={chartRange === "30D" ? 4 : "preserveStartEnd"} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8f8f95" }} tickFormatter={(val) => formatChartAmount(Number(val))} />
                  <Tooltip
                    contentStyle={{ borderRadius: "12px", border: "1px solid rgba(255,255,255,0.1)", background: "#111", color: "#fff", boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }}
                    formatter={(value: any) => [formatChartAmount(Number(value)), "total"]}
                  />
                  <Area type="monotone" dataKey="total" stroke="#a855f7" strokeWidth={2} fillOpacity={1} fill="url(#colorTotal)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-[#0a0a0a] rounded-3xl p-8 shadow-sm border border-white/5">
            <h3 className="text-sm font-bold text-white mb-1">Transaction Distribution</h3>
            <p className="text-xs text-[#8f8f95] mb-8">Volume breakdown by type</p>
            <div className="h-[240px] w-full flex items-center justify-center relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={distributionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    {distributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid rgba(255,255,255,0.1)", background: "#111", color: "#fff", boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute bottom-[-10px] w-full flex justify-center gap-6">
                {distributionData.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }}></div>
                    <span className="text-[10px] font-bold text-[#8f8f95]">{d.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[#0b0f14] border border-white/10 rounded-3xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.35)] flex flex-col" style={{ maxHeight: "calc(100vh - 120px)" }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-6 border-b border-white/10 gap-4 shrink-0">
            <h2 className="text-lg font-bold text-white tracking-tight">All Transactions</h2>

            <div className="flex items-center gap-4">
              <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                {["All", "Payouts", "Deposits"].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setFilterTab(tab as any)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${filterTab === tab
                        ? "bg-[#a855f7] text-black shadow-sm"
                        : "text-[#8f8f95] hover:text-white"
                      }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                {["All", "Streaming", "Private Payroll"].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setPayrollModeFilter(tab as typeof payrollModeFilter)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      payrollModeFilter === tab
                        ? "bg-[#a855f7]/15 text-[#c084fc]"
                        : "text-[#8f8f95] hover:text-white"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="relative hidden md:block">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f95]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search transactions..."
                  className="pl-9 pr-4 py-2 bg-white/5 rounded-xl text-xs text-white outline-none focus:ring-2 focus:ring-[#a855f7]/20 border border-white/10 focus:border-[#a855f7]/30 transition-all w-[200px] placeholder:text-[#8f8f95]"
                />
              </div>

              <button
                onClick={() => setAuditorModalOpen(true)}
                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-[#a855f7]/10 hover:bg-[#a855f7]/20 border border-[#a855f7]/20 text-[#a855f7] text-xs font-bold rounded-xl transition-colors shadow-sm"
              >
                <ShieldCheck size={14} />
                Auditor Link
              </button>

              <button
                onClick={handleExportCSV}
                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
              >
                <Download size={14} />
                Export CSV
              </button>
            </div>
          </div>

          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0b0f14]">
                  <th className="py-4 px-6 text-[10px] font-bold text-[#8f8f95] uppercase tracking-widest border-b border-white/10">Type</th>
                  <th className="py-4 px-6 text-[10px] font-bold text-[#8f8f95] uppercase tracking-widest border-b border-white/10">Recipient</th>
                  <th className="py-4 px-6 text-[10px] font-bold text-[#8f8f95] uppercase tracking-widest border-b border-white/10 text-center">Amount</th>
                  <th className="py-4 px-6 text-[10px] font-bold text-[#8f8f95] uppercase tracking-widest border-b border-white/10">Date & Time</th>
                  <th className="py-4 px-6 text-[10px] font-bold text-[#8f8f95] uppercase tracking-widest border-b border-white/10">Privacy</th>
                  <th className="py-4 px-6 text-[10px] font-bold text-[#8f8f95] uppercase tracking-widest border-b border-white/10">Status</th>
                  <th className="py-4 px-6 text-[10px] font-bold text-[#8f8f95] uppercase tracking-widest border-b border-white/10 text-right">TX Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="py-24 text-center">
                      <Loader2 size={24} className="animate-spin text-[#a855f7] mx-auto mb-4" />
                    </td>
                  </tr>
                ) : filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-24 text-center">
                      <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                        <History size={20} className="text-[#a8a8aa]/40" />
                      </div>
                      <p className="text-sm font-bold text-white tracking-tight">No transactions found</p>
                      <p className="text-xs text-[#8f8f95] mt-1">
                        Deposits, payroll runs, and claims will appear here.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((item) => (
                    <tr key={item.id} className="hover:bg-white/[0.03] transition-colors">
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.type === "Private Vault Deposit" ? "bg-[#a855f7]/10 text-[#a855f7]" :
                              "bg-amber-500/10 text-amber-500"
                            }`}>
                            {item.type === "Private Vault Deposit" ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                          </div>
                          <span className="text-sm font-bold text-white">{item.type}</span>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div className="text-sm font-bold text-white">{item.meta}</div>
                        {item.txSig && <div className="text-[10px] text-[#8f8f95] font-mono mt-0.5">{item.txSig.slice(0, 8)}...</div>}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <div className="text-sm font-bold text-white">
                          {item.type === "Private Vault Deposit" ? "+" : "-"}${formatTxAmount(item.amount)}
                        </div>
                        <div className="text-[10px] text-[#8f8f95] mt-0.5">USDC</div>
                      </td>
                      <td className="py-4 px-6 whitespace-nowrap">
                        <span className="text-sm text-white font-medium">{new Date(item.date).toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' }).replace(/\//g, '-')}</span>
                        <span className="text-[10px] text-[#8f8f95] ml-2">{new Date(item.date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                      </td>
                      <td className="py-4 px-6">
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#a855f7]/10 text-[#a855f7] text-[10px] font-bold">
                          <ShieldCheck size={10} />
                          Secured
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold ${item.status === "success" ? "bg-[#a855f7]/10 text-[#a855f7]" : "bg-red-500/10 text-red-400"
                          }`}>
                          {item.status === "success" ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                          {item.status === "success" ? "Completed" : "Failed"}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-right">
                        {item.txSig ? (
                          <a
                            href={`https://stellarchain.io/transactions/${item.txSig}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] font-mono text-[#a855f7] hover:text-[#a855f7]/70 transition-colors cursor-pointer hover:underline"
                          >
                            {item.txSig.slice(0, 6)}...{item.txSig.slice(-4)}
                          </a>
                        ) : (
                          <span className="text-[10px] font-mono text-[#8f8f95]">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </EmployerLayout>
  );
}

export default function TreasuryPage() {
  return (
    <Suspense fallback={null}>
      <TreasuryPageContent />
    </Suspense>
  );
}
