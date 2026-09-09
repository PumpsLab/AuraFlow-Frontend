"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useRouter } from "next/navigation";
import {
  Wallet,
  RefreshCw,
  Layers,
  Users,
  PlayCircle,
  DollarSign,
  CalendarDays,
  AlertTriangle,
  Download,
  Plus,
  Building2,
  Coins,
  ExternalLink,
  Loader2,
} from "lucide-react";

import Link from "next/link";

import { toast } from "sonner";
import { EmployerLayout } from "@/components/employer-layout";
import { walletAuthenticatedFetch } from "@/lib/wallet/wallet-auth-fetch";
import { RunwayProjectionChart } from "@/components/ui/payroll-chart";
import { CompensationBreakdownChart } from "@/components/ui/crypto-distribution-chart";
import { DepositModal } from "@/components/deposit-modal";
import { SetupCompanyModal } from "@/components/setup-company-modal";
import {
  InteractiveGuide,
  type GuideStep,
  useGuideStatus,
  useGuideTargetReady,
} from "@/components/ui/interactive-guide";
import { getBalance } from "@/lib/private-payroll-api";

const DASHBOARD_BALANCE_CACHE_KEY = "auraflow:employer-dashboard-balance-cache";
const PEOPLE_ONBOARDING_HANDOFF_KEY = "auraflow:people-onboarding-handoff";

type DashboardBalanceCache = {
  wallet: string;
  vaultBalance: number;
  baseBalance: number;
};

function loadDashboardBalanceCache(): DashboardBalanceCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DASHBOARD_BALANCE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DashboardBalanceCache;
  } catch {
    return null;
  }
}

function saveDashboardBalanceCache(cache: DashboardBalanceCache) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      DASHBOARD_BALANCE_CACHE_KEY,
      JSON.stringify(cache),
    );
  } catch {
    // Session storage can be unavailable in privacy-restricted contexts.
    // Treat cache writes as best-effort only.
  }
}

type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partially_failed"
  | "failed"
  | "cancelled";

type CycleStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "processing"
  | "completed"
  | "cancelled";

interface RealPayrollRun {
  id: string;
  cycleId: string;
  status: RunStatus;
  totals?: {
    itemCount: number;
    paidCount: number;
    failedCount: number;
    grossAmount: number;
    netAmount: number;
  };
  createdAt: string;
}

interface RealPayrollCycle {
  id: string;
  label: string;
  payDate: string;
  status: CycleStatus;
  totals: {
    employeeCount: number;
    grossAmount: number;
    netAmount: number;
  };
  itemCount?: number;
  createdAt: string;
}

interface HistoryPayrollRun {
  id: string;
  date: string;
  mode?: "streaming" | "private_payroll";
  payPeriod?: string;
  totalAmount: number;
  employeeIds?: string[];
  recipientAddresses?: string[];
  employeeAmounts?: number[];
  status: "success" | "failed" | "submitted";
  providerMeta?: {
    action?: string;
  };
}

type DashboardRecentActivity =
  | {
    id: string;
    kind: "stream_run";
    date: string;
    status: RunStatus;
    title: string;
    subtitle: string;
    peopleText: string;
    amountUsd: number;
  }
  | {
    id: string;
    kind: "private_transfer";
    date: string;
    status: "success" | "failed" | "submitted";
    title: string;
    subtitle: string;
    peopleText: string;
    amountUsd: number;
  };

function resolvePayrollRunMode(
  run: HistoryPayrollRun,
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

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function statusChip(status: RunStatus | CycleStatus) {
  if (status === "running" || status === "processing") {
    return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  }
  if (status === "completed") {
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  }
  if (status === "approved") {
    return "bg-green-500/10 text-green-400 border-green-500/20";
  }
  if (status === "draft" || status === "queued" || status === "pending_approval") {
    return "bg-white/5 text-[#a8a8aa] border-white/10";
  }
  if (status === "partially_failed") {
    return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  }
  return "bg-red-500/10 text-red-400 border-red-500/20";
}

function historyStatusChip(status: HistoryPayrollRun["status"]) {
  if (status === "success") {
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  }
  if (status === "submitted") {
    return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  }
  return "bg-red-500/10 text-red-400 border-red-500/20";
}

const FIRST_TIME_SETUP_STEPS: GuideStep[] = [
  {
    id: "setup-company",
    target: '[data-guide="setup-company"]',
    title: "Start with company setup",
    description:
      "Create your company treasury first. This unlocks payroll funding and the rest of the employer workflow.",
    position: "bottom",
  },
  {
    id: "deposit-treasury",
    target: '[data-guide="deposit-treasury"]',
    title: "Deposit comes next",
    description:
      "After setup, fund your treasury here so payroll has balance ready before you add and pay employees.",
    position: "bottom",
  },
  {
    id: "employee-nav",
    target: '[data-guide="employee-nav"]',
    title: "Add employees from here",
    description:
      "Open Employees after funding. That is where you add a teammate and choose instant private payroll or real-time streaming.",
    position: "right",
  },
];

const ACTIVE_COMPANY_STEPS: GuideStep[] = [
  {
    id: "deposit-treasury",
    target: '[data-guide="deposit-treasury"]',
    title: "Fund your payroll treasury",
    description:
      "Deposit funds here so your private treasury is ready before disbursing salaries.",
    position: "bottom",
  },
  {
    id: "employee-nav",
    target: '[data-guide="employee-nav"]',
    title: "Add employees from here",
    description:
      "Go to Employees next to onboard a teammate. The two payroll modes guide continues there.",
    position: "right",
  },
  {
    id: "run-payroll",
    target: '[data-guide="run-payroll"]',
    title: "Run payroll when ready",
    description:
      "Once treasury and employees are ready, continue here to run payroll.",
    position: "bottom",
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const { connected, publicKey, signMessage } = useWallet();
  const walletAddr = publicKey ?? "";
  const initialBalanceCache = loadDashboardBalanceCache();

  const [runs, setRuns] = useState<RealPayrollRun[]>([]);
  const [cycles, setCycles] = useState<RealPayrollCycle[]>([]);
  const [historyPayrollRuns, setHistoryPayrollRuns] = useState<HistoryPayrollRun[]>([]);
  const [employees, setEmployees] = useState<Array<{
    id: string; wallet: string; name: string; monthlySalaryUsd?: number;
    compensationAmountUsd?: number; compensationUnit?: string;
  }>>([]);
  const [streams, setStreams] = useState<Array<{
    id: string; employeeId: string; status: "active" | "paused" | "stopped";
    ratePerSecond: number; totalPaid: number;
    startsAt?: string | null; lastPaidAt?: string | null;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [vaultBalance, setVaultBalance] = useState<number>(
    initialBalanceCache?.vaultBalance ?? 0,
  );
  const [baseBalance, setBaseBalance] = useState<number>(
    initialBalanceCache?.baseBalance ?? 0,
  );
  const [vaultBalanceLoading, setVaultBalanceLoading] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [devnetFundsOpen, setDevnetFundsOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [company, setCompany] = useState<{ id: string; name: string; treasuryPubkey: string } | null>(null);
  const [dashboardGuideOpenForWallet, setDashboardGuideOpenForWallet] = useState<string | null>(null);
  const [hasShownDashboardGuideForWallet, setHasShownDashboardGuideForWallet] = useState<string | null>(null);
  const dashboardGuideScope = walletAddr || "guest";
  const hasShownDashboardGuide = !!walletAddr && hasShownDashboardGuideForWallet === walletAddr;
  const isDashboardGuideOpen = !!walletAddr && dashboardGuideOpenForWallet === walletAddr;
  const dashboardGuideMilestoneCompleted =
    !!company?.id && vaultBalance > 0 && employees.length > 0;
  const {
    hasCompleted: hasCompletedDashboardGuide,
    markCompleted: markDashboardGuideCompleted,
  } = useGuideStatus("dashboard-onboarding", dashboardGuideScope);
  const firstDashboardGuideTarget = (company ? ACTIVE_COMPANY_STEPS : FIRST_TIME_SETUP_STEPS)[0]?.target;
  const isDashboardGuideTargetReady = useGuideTargetReady(firstDashboardGuideTarget, {
    enabled:
      connected &&
      !!walletAddr &&
      !hasCompletedDashboardGuide &&
      !hasShownDashboardGuide,
  });

  const companyRef = useRef(company);
  const devnetFundsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    companyRef.current = company;
  }, [company]);

  useEffect(() => {
    if (!connected || !walletAddr) {
      setDashboardGuideOpenForWallet(null);
      setHasShownDashboardGuideForWallet(null);
    }
  }, [connected, walletAddr]);

  useEffect(() => {
    if (dashboardGuideMilestoneCompleted && !hasCompletedDashboardGuide) {
      markDashboardGuideCompleted();
    }
  }, [
    dashboardGuideMilestoneCompleted,
    hasCompletedDashboardGuide,
    markDashboardGuideCompleted,
  ]);

  useEffect(() => {
    if (hasCompletedDashboardGuide) {
      setDashboardGuideOpenForWallet(null);
    }
  }, [hasCompletedDashboardGuide]);

  useEffect(() => {
    if (!walletAddr) return;
    saveDashboardBalanceCache({
      wallet: walletAddr,
      vaultBalance,
      baseBalance,
    });
  }, [walletAddr, vaultBalance, baseBalance]);

  useEffect(() => {
    const cache = loadDashboardBalanceCache();
    if (cache?.wallet === walletAddr) {
      const frame = window.requestAnimationFrame(() => {
        setVaultBalance(cache.vaultBalance);
        setBaseBalance(cache.baseBalance);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (!walletAddr) {
      const frame = window.requestAnimationFrame(() => {
        setVaultBalance(0);
        setBaseBalance(0);
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [walletAddr]);

  const signMessageRef = useRef(signMessage);
  useEffect(() => {
    signMessageRef.current = signMessage;
  }, [signMessage]);

  const refreshVaultBalance = useCallback(async () => {
    if (!walletAddr) return;
    setVaultBalanceLoading(true);
    try {
      // Base balance is always safe to fetch and show.
      const baseBalRes = await getBalance(walletAddr).catch(() => null);
      if (baseBalRes) {
        setBaseBalance(parseInt(baseBalRes.balance ?? "0", 10) / 1_000_000);
      }

      // Treasury card must never fall back to the connected wallet's personal
      // private balance, otherwise the dashboard shows misleading funds.
      const currentCompany = companyRef.current;
      if (currentCompany?.id) {
        const currentSignMessage = signMessageRef.current;
        if (!currentSignMessage) return;
        const treasuryRes = await walletAuthenticatedFetch({
          wallet: walletAddr,
          signMessage: currentSignMessage,
          path: `/api/v1/companies/${currentCompany.id}/balance?wallet=${walletAddr}`,
        }).catch(() => null);
        if (treasuryRes && treasuryRes.ok) {
          const data = await treasuryRes.json();
          const raw = typeof (data as any).balance === "string" ? (data as any).balance : ((data as any).balance?.usdc ?? "0");
          setVaultBalance(parseFloat(String(raw)) || 0);
        }
      } else {
        setVaultBalance(0);
      }
    } catch {
      // Keep stale values instead of crashing dashboard render.
    } finally {
      setVaultBalanceLoading(false);
    }
  }, [walletAddr]);

  const loadDashboard = useCallback(async () => {
    const currentSignMessage = signMessageRef.current;
    if (!walletAddr || !currentSignMessage) {
      setRuns([]);
      setCycles([]);
      setHistoryPayrollRuns([]);
      setCompany(null);
      return;
    }

    setLoading(true);
    try {
      const [runsRes, cyclesRes, empRes, strRes, compRes, historyRes] = await Promise.all([
        walletAuthenticatedFetch({
          wallet: walletAddr,
          signMessage: currentSignMessage,
          path: `/api/v1/payroll-runs/runs?employerWallet=${walletAddr}`,
        }),
        walletAuthenticatedFetch({
          wallet: walletAddr,
          signMessage: currentSignMessage,
          path: `/api/v1/payroll-runs/cycles?employerWallet=${walletAddr}`,
        }),
        walletAuthenticatedFetch({
          wallet: walletAddr,
          signMessage: currentSignMessage,
          path: `/api/v1/employees?employerWallet=${walletAddr}`,
        }),
        walletAuthenticatedFetch({
          wallet: walletAddr,
          signMessage: currentSignMessage,
          path: `/api/v1/streams?employerWallet=${walletAddr}`,
        }),
        walletAuthenticatedFetch({
          wallet: walletAddr,
          signMessage: currentSignMessage,
          path: `/api/v1/companies/me?employerWallet=${walletAddr}`,
        }),
        walletAuthenticatedFetch({
          wallet: walletAddr,
          signMessage: currentSignMessage,
          path: `/api/v1/history?wallet=${walletAddr}`,
        }).catch(() => null),
      ]);

      const runsJson = (await runsRes.json()) as {
        runs?: RealPayrollRun[];
        error?: string;
      };
      const cyclesJson = (await cyclesRes.json()) as {
        cycles?: RealPayrollCycle[];
        error?: string;
      };
      const empJson = (await empRes.json()) as { employees?: typeof employees };
      const strJson = (await strRes.json()) as { streams?: typeof streams };

      if (runsRes.ok) {
        setRuns(runsJson.runs ?? []);
      }
      if (cyclesRes.ok) {
        setCycles(cyclesJson.cycles ?? []);
      }
      if (empRes.ok) {
        setEmployees(empJson.employees ?? []);
      }
      if (strRes.ok) {
        setStreams(strJson.streams ?? []);
      }
      if (compRes.ok) {
        const compJson = await compRes.json();
        setCompany(compJson.company || null);
      }
      if (historyRes && historyRes.ok) {
        const historyJson = (await historyRes.json()) as {
          payrollRuns?: HistoryPayrollRun[];
        };
        setHistoryPayrollRuns(historyJson.payrollRuns ?? []);
      } else {
        setHistoryPayrollRuns([]);
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Dashboard load failed");
    } finally {
      setLoading(false);
    }

    // Keep balance refresh independent so run/cycle API issues don't block funds UI.
    void refreshVaultBalance();
  }, [walletAddr, refreshVaultBalance]);

  // Load dashboard on initial connection or wallet changes
  useEffect(() => {
    if (walletAddr) {
      void loadDashboard();
    }
  }, [walletAddr]);

  // Auto-refresh every 1 minute (60,000 ms)
  useEffect(() => {
    if (!walletAddr) return;

    const interval = window.setInterval(() => {
      void loadDashboard();
    }, 60000);

    return () => window.clearInterval(interval);
  }, [walletAddr]);

  useEffect(() => {
    const shouldBlockFromCompletion = hasCompletedDashboardGuide;

    if (
      !connected ||
      !walletAddr ||
      shouldBlockFromCompletion ||
      hasShownDashboardGuide ||
      !isDashboardGuideTargetReady
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setDashboardGuideOpenForWallet(walletAddr);
      setHasShownDashboardGuideForWallet(walletAddr);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    connected,
    dashboardGuideOpenForWallet,
    hasShownDashboardGuideForWallet,
    walletAddr,
    hasCompletedDashboardGuide,
    hasShownDashboardGuide,
    isDashboardGuideTargetReady,
  ]);



  const totalGross = useMemo(
    () => runs.reduce((sum, run) => sum + (run.totals?.grossAmount ?? 0), 0),
    [runs],
  );

  const recentActivities = useMemo<DashboardRecentActivity[]>(() => {
    const streamActivities: DashboardRecentActivity[] = runs.map((run) => ({
      id: `stream:${run.id}`,
      kind: "stream_run",
      date: run.createdAt,
      status: run.status,
      title: `Run ${run.id.slice(0, 8)}...`,
      subtitle: `${formatDate(run.createdAt)} • Cycle ${run.cycleId.slice(0, 8)}...`,
      peopleText: `${run.totals?.paidCount ?? 0}/${run.totals?.itemCount ?? 0}`,
      amountUsd: run.totals?.netAmount ?? 0,
    }));

    const privateActivities: DashboardRecentActivity[] = historyPayrollRuns
      .filter(
        (run) =>
          resolvePayrollRunMode(run) === "private_payroll" &&
          Number.isFinite(run.totalAmount) &&
          run.totalAmount > 0,
      )
      .map((run) => ({
        id: `private:${run.id}`,
        kind: "private_transfer",
        date: run.date,
        status: run.status,
        title: "Private Transfer",
        subtitle: run.payPeriod
          ? `${formatDate(run.date)} • ${run.payPeriod}`
          : formatDate(run.date),
        peopleText:
          run.employeeIds?.length ||
            run.recipientAddresses?.length
            ? String(
              (run.employeeIds?.length ?? 0) ||
              (run.recipientAddresses?.length ?? 0),
            )
            : "1",
        amountUsd: run.totalAmount,
      }));

    return [...streamActivities, ...privateActivities]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10);
  }, [runs, historyPayrollRuns]);

  const privateTransferRuns = useMemo(
    () =>
      historyPayrollRuns.filter(
        (run) =>
          resolvePayrollRunMode(run) === "private_payroll" &&
          run.status !== "failed" &&
          Number.isFinite(run.totalAmount) &&
          run.totalAmount > 0,
      ),
    [historyPayrollRuns],
  );

  const currentMonthPrivateTransferBurn = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    let sum = 0;

    for (const run of privateTransferRuns) {
      const date = new Date(run.date);
      if (date.getFullYear() === year && date.getMonth() === month) {
        sum += run.totalAmount;
      }
    }
    return sum;
  }, [privateTransferRuns]);

  const privateTransferDisbursed = useMemo(
    () => privateTransferRuns.reduce((sum, run) => sum + run.totalAmount, 0),
    [privateTransferRuns],
  );

  const privateTransferAllocations = useMemo(() => {
    const byEmployeeId = new Map(employees.map((employee) => [employee.id, employee]));
    const byWallet = new Map(
      employees.map((employee) => [employee.wallet.toLowerCase(), employee]),
    );

    const allocations: Array<{ employeeId: string; amountUsd: number }> = [];
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    for (const run of privateTransferRuns) {
      const runDate = new Date(run.date);
      if (runDate.getFullYear() !== year || runDate.getMonth() !== month) continue;

      if (Array.isArray(run.employeeIds) && Array.isArray(run.employeeAmounts)) {
        const pairedLength = Math.min(run.employeeIds.length, run.employeeAmounts.length);
        for (let i = 0; i < pairedLength; i += 1) {
          const employeeId = run.employeeIds[i];
          const amountUsd = Number(run.employeeAmounts[i] ?? 0);
          if (!employeeId || !Number.isFinite(amountUsd) || amountUsd <= 0) continue;
          if (!byEmployeeId.has(employeeId)) continue;
          allocations.push({ employeeId, amountUsd });
        }
        continue;
      }

      const recipients = run.recipientAddresses ?? [];
      const amounts = run.employeeAmounts ?? [];
      const fallbackAmountEach =
        recipients.length > 0 ? run.totalAmount / recipients.length : 0;

      for (let i = 0; i < recipients.length; i += 1) {
        const recipient = recipients[i]?.toLowerCase();
        if (!recipient) continue;
        const employee = byWallet.get(recipient);
        if (!employee) continue;
        const amountUsd = Number(amounts[i] ?? fallbackAmountEach);
        if (!Number.isFinite(amountUsd) || amountUsd <= 0) continue;
        allocations.push({ employeeId: employee.id, amountUsd });
      }
    }

    return allocations;
  }, [employees, privateTransferRuns]);

  const activeStreamsCount = useMemo(() => {
    let count = 0;
    for (const emp of employees) {
      const stream = streams.find((s) => s.employeeId === emp.id);
      if (stream && stream.status === "active") {
        count++;
      }
    }
    return count;
  }, [employees, streams]);

  const totalEmployees = employees.length;

  const monthlyStreamingBurnRate = useMemo(() => {
    let sum = 0;
    for (const emp of employees) {
      const stream = streams.find((s) => s.employeeId === emp.id);
      if (stream && stream.status === "active") {
        // Prefer stored salary to avoid drift from rounded stream rates.
        if (emp.monthlySalaryUsd) {
          sum += emp.monthlySalaryUsd;
        } else if (emp.compensationAmountUsd && emp.compensationUnit === "monthly") {
          sum += emp.compensationAmountUsd;
        } else {
          // Fallback when salary snapshot is missing: derive monthly from rate/sec.
          sum += stream.ratePerSecond * 86400 * 30;
        }
      }
    }
    return sum;
  }, [employees, streams]);

  const monthlyBurnRate = useMemo(
    () => monthlyStreamingBurnRate + currentMonthPrivateTransferBurn,
    [monthlyStreamingBurnRate, currentMonthPrivateTransferBurn],
  );

  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const totalDisbursed = useMemo(() => {
    let accruedAmount = 0;
    for (const stream of streams) {
      if (stream.status !== "active") continue;
      
      const startsAtMs = stream.startsAt ? new Date(stream.startsAt).getTime() : nowMs;
      const lastAccrualTs = stream.lastPaidAt ? new Date(stream.lastPaidAt).getTime() : startsAtMs;
      
      const effectiveNowMs = Math.max(nowMs, lastAccrualTs);
      const secondsDiff = (effectiveNowMs - lastAccrualTs) / 1000;
      
      accruedAmount += stream.ratePerSecond * secondsDiff;
    }
    
    const baseDisbursed = streams.reduce((sum, s) => sum + (s.totalPaid ?? 0), 0) + privateTransferDisbursed;
    return baseDisbursed + accruedAmount;
  }, [streams, privateTransferDisbursed, nowMs]);

  const failedRuns = useMemo(
    () =>
      runs.filter(
        (run) => run.status === "failed" || run.status === "partially_failed",
      ).length,
    [runs],
  );

  const dashboardGuideSteps = company ? ACTIVE_COMPANY_STEPS : FIRST_TIME_SETUP_STEPS;

  useEffect(() => {
    if (!connected || !walletAddr) {
      const frame = window.requestAnimationFrame(() => {
        setDashboardGuideOpenForWallet(null);
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [connected, walletAddr]);

  useEffect(() => {
    if (!devnetFundsOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!devnetFundsRef.current?.contains(event.target as Node)) {
        setDevnetFundsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDevnetFundsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [devnetFundsOpen]);



  return (
    <EmployerLayout>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">{company ? company.name : "Employer Dashboard"}</h1>
            <p className="text-sm text-[#a8a8aa] mt-1">
              {company
                ? `Treasury: ${company.treasuryPubkey.slice(0, 6)}...${company.treasuryPubkey.slice(-4)} · Stellar handles funding and exits, while Soroban runs live private payroll.`
                : "Stellar handles setup and treasury funding, while Soroban runs live private payroll."}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => void loadDashboard()}
              disabled={loading || !connected}
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-[#0a0a0a] p-3 text-white transition-colors hover:bg-white/5 disabled:opacity-40 shadow-sm h-[44px] w-[44px]"
              title="Refresh Dashboard"
            >
              {loading ? <RefreshCw size={18} className="animate-spin text-[#a8a8aa]" /> : <RefreshCw size={18} className="text-[#a8a8aa]" />}
            </button>

            <div ref={devnetFundsRef} className="relative">
              <button
                type="button"
                onClick={() => setDevnetFundsOpen((prev) => !prev)}
                className="inline-flex h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[#0a0a0a] px-5 text-sm font-semibold text-white transition-colors hover:bg-white/5 shadow-sm"
              >
                <Coins size={16} className="text-[#a8a8aa]" />
                Devnet Funds
              </button>

              {devnetFundsOpen ? (
                <div className="absolute right-0 top-[calc(100%+0.75rem)] z-30 w-[260px] rounded-[1.5rem] border border-white/10 bg-[#0a0a0a] p-3 shadow-2xl">
                  <p className="px-2 pb-2 font-lexend text-[10px] font-bold uppercase tracking-[0.18em] text-[#a8a8aa]">
                    Quick top up
                  </p>

                  <a
                    href="https://faucet.stellar.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/10"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                      <img src="/stellar-logo.png" alt="XLM" className="w-5 h-5 object-contain" />
                    </div>
                    <div className="flex-1">
                      <p className="font-lexend text-sm font-semibold text-white">Get Testnet XLM</p>
                      <p className="mt-0.5 text-xs text-[#a8a8aa]">Fund gas on Stellar Testnet</p>
                    </div>
                    <ExternalLink size={14} className="text-[#a8a8aa]" />
                  </a>

                  <a
                    href="https://faucet.circle.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/10"
                  >
                    <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                      <img src="/usdc-logo.png" alt="USDC" className="w-5 h-5 object-contain" />
                    </div>
                    <div className="flex-1">
                      <p className="font-lexend text-sm font-semibold text-white">Get Devnet USDC</p>
                      <p className="mt-0.5 text-xs text-[#a8a8aa]">Top up payroll test funds</p>
                    </div>
                    <ExternalLink size={14} className="text-[#a8a8aa]" />
                  </a>
                </div>
              ) : null}
            </div>

            <button
              onClick={() => setDepositOpen(true)}
              data-guide="deposit-treasury"
              disabled={!company}
              className="inline-flex h-[44px] items-center gap-2 rounded-2xl border border-white/10 bg-[#0a0a0a] px-5 text-sm font-semibold text-white transition-colors hover:bg-white/5 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={16} className={company ? "text-[#a8a8aa]" : "text-[#a8a8aa]/50"} />
              Deposit
            </button>

            {company ? (
              <Link
                href="/payouts"
                data-guide="run-payroll"
                className="inline-flex h-[44px] w-full items-center justify-center gap-2 rounded-2xl bg-[#a855f7] px-5 text-xs font-semibold text-black transition-colors hover:bg-[#a855f7]/80 shadow-[0_0_20px_rgba(168,85,247,0.3)]"
              >
                <Plus size={16} />
                Run Payroll
              </Link>
            ) : (
              <button
                onClick={() => setSetupOpen(true)}
                data-guide="setup-company"
                className="inline-flex h-[44px] items-center gap-2 rounded-2xl bg-[#a855f7] px-5 text-sm font-semibold text-black transition-colors hover:bg-[#a855f7]/80 shadow-[0_0_20px_rgba(168,85,247,0.3)]"
              >
                <Building2 size={16} />
                Setup Company
              </button>
            )}
          </div>
        </div>

        {!connected ? (
          <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-14 text-center shadow-sm">
            <Wallet size={40} className="mx-auto mb-4 text-[#a8a8aa]" />
            <p className="text-lg font-semibold text-white">Connect wallet to load live on-chain treasury data</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 shadow-sm relative overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a8a8aa]">Private Treasury Balance</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-white flex items-baseline gap-1.5">
                  {formatUsd(vaultBalance)}
                  <span className="text-xs text-[#8f8f95] font-semibold">USDC</span>
                </p>
                <p className="mt-1 text-xs text-[#a8a8aa]">Private USDC treasury liquidity inside TEE enclave</p>
                <div className="absolute top-5 right-5 w-6 h-6 opacity-80">
                  <img src="/usdc-logo.png" alt="USDC" className="w-full h-full object-contain" />
                </div>
                {vaultBalanceLoading && (
                  <div className="absolute inset-0 backdrop-blur-[2px] bg-[#0a0a0a]/60 flex items-center justify-center">
                    <Loader2 size={20} className="animate-spin text-[#a855f7]" />
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a8a8aa]">Total Employees</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-white">{totalEmployees}</p>
                <p className="mt-1 text-xs text-[#a8a8aa]">All registered team members</p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a8a8aa]">Total Payouts</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-white">{formatUsd(totalDisbursed)}</p>
                <p className="mt-1 text-xs text-[#a8a8aa]">All-time crypto paid to employees</p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a8a8aa]">Active Streams</p>
                <p className="mt-2 text-2xl font-bold tracking-tight text-white">
                  {activeStreamsCount}/{Math.max(totalEmployees, activeStreamsCount)}
                </p>
                <p className="mt-1 text-xs text-[#a8a8aa]">Employees actively receiving funds</p>
              </div>
            </div>

            {failedRuns > 0 ? (
              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                <AlertTriangle size={16} className="mt-0.5 text-amber-400" />
                <p className="text-sm text-amber-400">
                  {failedRuns} run(s) contain failures. Open Runs page to retry failed items.
                </p>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RunwayProjectionChart vaultBalance={vaultBalance} monthlyBurnRate={monthlyBurnRate} />
              <CompensationBreakdownChart
                employees={employees}
                streams={streams}
                privateTransferAllocations={privateTransferAllocations}
              />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <PlayCircle size={16} className="text-[#a8a8aa]" />
                  <p className="text-sm font-bold text-white">Recent Payroll Activity</p>
                </div>
                <div className="space-y-3">
                  {recentActivities.length === 0 ? (
                    <p className="text-sm text-[#a8a8aa]">No payroll activity yet.</p>
                  ) : (
                    recentActivities.map((activity) => (
                      <div
                        key={activity.id}
                        className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{activity.title}</p>
                            <p className="text-xs text-[#a8a8aa]">{activity.subtitle}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${activity.kind === "stream_run"
                                ? "border-blue-500/20 bg-blue-500/10 text-blue-300"
                                : "border-violet-500/20 bg-violet-500/10 text-violet-300"
                                }`}
                            >
                              {activity.kind === "stream_run" ? "stream" : "private"}
                            </span>
                            <span
                              className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${activity.kind === "stream_run"
                                ? statusChip(activity.status)
                                : historyStatusChip(activity.status)
                                }`}
                            >
                              {activity.status.replace("_", " ")}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-4 text-xs text-[#a8a8aa]">
                          <span className="inline-flex items-center gap-1">
                            <Users size={12} />
                            {activity.peopleText}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <DollarSign size={12} />
                            {formatUsd(activity.amountUsd)}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-6 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <CalendarDays size={16} className="text-[#a8a8aa]" />
                  <p className="text-sm font-bold text-white">Scheduled Payroll Cycles</p>
                </div>
                <div className="space-y-3">
                  {cycles.length === 0 ? (
                    <p className="text-sm text-[#a8a8aa]">
                      No scheduled cycles yet. Private transfers appear in Recent Payroll Activity.
                    </p>
                  ) : (
                    cycles.slice(0, 8).map((cycle) => (
                      <div
                        key={cycle.id}
                        className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{cycle.label}</p>
                            <p className="text-xs text-[#a8a8aa]">Pay date {formatDate(cycle.payDate)}</p>
                          </div>
                          <span
                            className={`rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${statusChip(
                              cycle.status,
                            )}`}
                          >
                            {cycle.status.replace("_", " ")}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-4 text-xs text-[#a8a8aa]">
                          <span className="inline-flex items-center gap-1">
                            <Layers size={12} />
                            {cycle.itemCount ?? cycle.totals.employeeCount} item(s)
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <DollarSign size={12} />
                            Gross {formatUsd(cycle.totals.grossAmount)}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-4 text-xs text-[#a8a8aa]">
              Total gross tracked: <span className="font-semibold text-white">{formatUsd(totalGross)}</span>.
            </div>
          </>
        )}
      </div>


      <DepositModal
        isOpen={depositOpen}
        onClose={() => setDepositOpen(false)}
        baseBalance={baseBalance}
        privateBalance={vaultBalance}
        treasuryPubkey={company?.treasuryPubkey}
        companyId={company?.id}
        onDepositSuccess={() => {
          void refreshVaultBalance();
          void loadDashboard();
        }}
      />
      <SetupCompanyModal
        isOpen={setupOpen}
        onClose={() => setSetupOpen(false)}
        onSuccess={() => {
          void loadDashboard();
        }}
      />
      <InteractiveGuide
        steps={dashboardGuideSteps}
        isOpen={connected && isDashboardGuideOpen}
        onClose={() => setDashboardGuideOpenForWallet(null)}
        onComplete={() => setDashboardGuideOpenForWallet(null)}
        storageKeyPrefix="dashboard-onboarding"
        storageScopeKey={dashboardGuideScope}
        persistCompletion={true}
      />
    </EmployerLayout>
  );
}
