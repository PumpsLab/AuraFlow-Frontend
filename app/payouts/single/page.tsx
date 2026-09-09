"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import {
  ArrowRight,
  ChevronLeft,
  Loader2,
  Search,
  ShieldCheck,
  Waves,
  Wallet,
} from "lucide-react";
import { EmployerLayout } from "@/components/employer-layout";
import { walletAuthenticatedFetch } from "@/lib/wallet/wallet-auth-fetch";
import { toast } from "sonner";

type SinglePayoutMode = "private" | "stream";

interface Employee {
  id: string;
  wallet: string;
  name: string;
  department?: string;
  role?: string;
  monthlySalaryUsd?: number;
  compensationAmountUsd?: number;
  privateRecipientInitStatus?: "pending" | "processing" | "confirmed" | "failed";
}

interface StreamInfo {
  id: string;
  employeeId: string;
  status: "active" | "paused" | "stopped";
}

function shortWallet(address: string) {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function resolveMode(raw: string | null): SinglePayoutMode {
  return raw === "stream" ? "stream" : "private";
}

function SinglePayoutSelectorContent() {
  const searchParams = useSearchParams();
  const { publicKey, signMessage } = useWallet();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const mode = useMemo(
    () => resolveMode(searchParams.get("mode")),
    [searchParams],
  );
  const walletAddr = publicKey;

  const loadData = useCallback(async () => {
    if (!walletAddr || !signMessage) {
      setEmployees([]);
      setStreams([]);
      return;
    }
    setLoading(true);
    try {
      const [employeesRes, streamsRes] = await Promise.all([
        walletAuthenticatedFetch({
          wallet: walletAddr,
          signMessage,
          path: `/api/v1/employees?employerWallet=${walletAddr}`,
        }),
        walletAuthenticatedFetch({
          wallet: walletAddr,
          signMessage,
          path: `/api/v1/streams?employerWallet=${walletAddr}`,
        }),
      ]);

      const employeesPayload = (await employeesRes.json()) as {
        employees?: Employee[];
        error?: string;
      };
      const streamsPayload = (await streamsRes.json()) as {
        streams?: StreamInfo[];
        error?: string;
      };

      if (!employeesRes.ok) {
        throw new Error(employeesPayload.error || "Failed to load employees");
      }
      if (!streamsRes.ok) {
        throw new Error(streamsPayload.error || "Failed to load streams");
      }

      setEmployees(employeesPayload.employees ?? []);
      setStreams(streamsPayload.streams ?? []);
    } catch (error: unknown) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load payout employee list",
      );
    } finally {
      setLoading(false);
    }
  }, [walletAddr, signMessage]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadData]);

  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return employees;
    return employees.filter((employee) => {
      return (
        employee.name.toLowerCase().includes(query) ||
        employee.wallet.toLowerCase().includes(query) ||
        (employee.department ?? "").toLowerCase().includes(query) ||
        (employee.role ?? "").toLowerCase().includes(query)
      );
    });
  }, [employees, search]);

  const modeConfig = useMemo(() => {
    if (mode === "stream") {
      return {
        title: "Realtime Private Stream",
        subtitle:
          "Choose one employee and open the live stream control page for PER realtime payroll.",
        actionLabel: "Open Stream Control",
        href: (employeeId: string) => `/disburse?employee=${employeeId}`,
      };
    }
    return {
      title: "Private Transfer",
      subtitle:
        "Choose one employee and open the private one-off transfer page with salary-month tracking.",
      actionLabel: "Open Private Transfer",
      href: (employeeId: string) => `/disburse/manual?employee=${employeeId}`,
    };
  }, [mode]);

  return (
    <EmployerLayout>
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Link
              href="/payouts"
              className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-[#a8a8aa] transition-colors hover:text-white"
            >
              <ChevronLeft size={14} />
              Back to Payouts
            </Link>
            <h1 className="text-3xl font-bold tracking-tight text-white">
              Single Payout: {modeConfig.title}
            </h1>
            <p className="mt-2 text-sm text-[#a8a8aa]">{modeConfig.subtitle}</p>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-[#0a0a0a] p-1 sm:flex">
            <Link
              href="/payouts/single?mode=private"
              className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] transition-colors ${
                mode === "private"
                  ? "bg-[#a855f7] text-black"
                  : "text-[#a8a8aa] hover:text-white"
              }`}
            >
              Private Transfer
            </Link>
            <Link
              href="/payouts/single?mode=stream"
              className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] transition-colors ${
                mode === "stream"
                  ? "bg-[#a855f7] text-black"
                  : "text-[#a8a8aa] hover:text-white"
              }`}
            >
              Realtime Stream
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-4">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8f8f95]"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search employee by name, wallet, department, or role..."
              className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-[#8f8f95] focus:border-[#a855f7]/40 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid gap-4">
          {loading ? (
            <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-10 text-center">
              <Loader2 size={20} className="mx-auto mb-3 animate-spin text-[#a855f7]" />
              <p className="text-sm text-[#a8a8aa]">Loading employee list...</p>
            </div>
          ) : filteredEmployees.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-10 text-center">
              <p className="text-sm text-[#a8a8aa]">
                {employees.length === 0
                  ? "No employees found yet. Add employees first from People."
                  : "No employees match your search."}
              </p>
            </div>
          ) : (
            filteredEmployees.map((employee) => {
              const stream = streams.find((item) => item.employeeId === employee.id) ?? null;
              const salary = employee.monthlySalaryUsd ?? employee.compensationAmountUsd ?? 0;
              const privateReady = employee.privateRecipientInitStatus === "confirmed";
              const isPrivateMode = mode === "private";
              const disabled = isPrivateMode && !privateReady;

              return (
                <article
                  key={employee.id}
                  className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-4"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-lg font-bold text-white">{employee.name}</p>
                      <p className="mt-1 text-xs font-mono text-[#8f8f95]">
                        {employee.wallet}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-[#d4d4d8]">
                          <Wallet size={12} className="mr-1 inline-block text-[#8f8f95]" />
                          {shortWallet(employee.wallet)}
                        </span>
                        {employee.department ? (
                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-[#d4d4d8]">
                            {employee.department}
                          </span>
                        ) : null}
                        {employee.role ? (
                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-[#d4d4d8]">
                            {employee.role}
                          </span>
                        ) : null}
                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-[#d4d4d8]">
                          Salary {formatUsd(salary)}
                        </span>
                        {stream ? (
                          <span className="rounded-full border border-[#a855f7]/30 bg-[#a855f7]/10 px-2.5 py-1 text-[11px] font-semibold text-[#63e7c8]">
                            <Waves size={12} className="mr-1 inline-block" />
                            Stream {stream.status}
                          </span>
                        ) : (
                          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-[#a8a8aa]">
                            No stream yet
                          </span>
                        )}
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                            privateReady
                              ? "border-[#a855f7]/30 bg-[#a855f7]/10 text-[#63e7c8]"
                              : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                          }`}
                        >
                          <ShieldCheck size={12} className="mr-1 inline-block" />
                          Private {employee.privateRecipientInitStatus ?? "pending"}
                        </span>
                      </div>
                    </div>

                    {disabled ? (
                      <button
                        type="button"
                        disabled
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-[#8f8f95]"
                      >
                        Private Init Required
                      </button>
                    ) : (
                      <Link
                        href={modeConfig.href(employee.id)}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#a855f7] px-4 text-sm font-bold text-black transition-colors hover:bg-[#a855f7]/85"
                      >
                        {modeConfig.actionLabel}
                        <ArrowRight size={16} />
                      </Link>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </EmployerLayout>
  );
}

function SinglePayoutFallback() {
  return (
    <EmployerLayout>
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="rounded-2xl border border-white/10 bg-[#0a0a0a] p-10 text-center">
          <Loader2 size={20} className="mx-auto mb-3 animate-spin text-[#a855f7]" />
          <p className="text-sm text-[#a8a8aa]">Loading single payout...</p>
        </div>
      </div>
    </EmployerLayout>
  );
}

export default function SinglePayoutSelectorPage() {
  return (
    <Suspense fallback={<SinglePayoutFallback />}>
      <SinglePayoutSelectorContent />
    </Suspense>
  );
}
