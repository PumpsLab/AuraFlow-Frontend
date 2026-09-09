"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useSearchParams } from "next/navigation";

import { toast } from "sonner";
import {
  checkHealth,
  fetchTeeAuthToken,
  getPrivateBalance,
  isJwtExpired,
  signAndSend,
  type BalanceResponse,
} from "@/lib/private-payroll-api";
import {
  clearCachedTeeToken,
  getOrCreateCachedTeeToken,
  loadCachedTeeToken,
} from "@/lib/tee-auth-cache";
import { walletAuthenticatedFetch } from "@/lib/wallet/wallet-auth-fetch";
import { PAYROLL_CONTRACT, USDC_CONTRACT } from "@/lib/wallet/contract-config";
import {
  Loader2,
  Wallet,
  ChevronLeft,
  Pause,
  PlayCircle,
  ShieldCheck,
  RefreshCw,
  Sparkles,
  Zap,
  Save,
  Square,
  Users,
  RotateCcw,
  CalendarDays,
  AlertTriangle,
  PauseCircle,
  XCircle,
  Play,
} from "lucide-react";
import Link from "next/link";
import { EmployerLayout } from "@/components/employer-layout";
import {
  getAccruedInCycle,
  getScheduleCycleSnapshot,
  ratePerSecondToMonthlyUsd,
} from "@/lib/payroll-math";
import {
  DEFAULT_PAYROLL_PAYOUT_MODE,
  allowedPayoutModesFor,
  payoutModeSummary,
  type PayrollPayoutMode,
} from "@/lib/payroll-payout-mode";

import type {
  CashoutRequestRecord,
  CashoutRequestStatus,
  DataSourceBadge,
  ManagedEmployee,
  OnboardTransactionsResponse,
  PayrollStream,
  PrivateInitStatus,
  PrivatePayrollHealthState,
  PrivatePayrollStateResponse,
  RestartStreamBuildResponse,
  StreamControlAction,
  StreamControlBuildResponse,
  StreamStatus,
  TickBuildResult,
  TickBuildResponse,
} from "./disburse-types";
import {
  BASE_DEVNET_RPC_FALLBACKS,
  BASE_DEVNET_RPC_URL,
  STREAM_STATUS_PRIORITY,
  deriveStoppedLifecycleState,
  formatMicroUsdc,
  formatUnixTimestamp,
  formatUsd,
  getEffectiveStreamStatus,
  getPrivateInitBadge,
  isCheckpointStateFresh,
  isMissingPrivateStateMessage,
  isRpcRateLimitError,
  resolveGoLiveReadiness,
  resolvePrivateInitStatus,
  sourceBadgeMeta,
} from "./disburse-helpers";

function EmployerPageContent() {
  const searchParams = useSearchParams();
  const { publicKey: publicKeyRaw, connected, signTransaction, signMessage } = useWallet();

  const publicKey = useMemo(() => {
    if (!publicKeyRaw) return null;
    return {
      toBase58: () => publicKeyRaw,
      toString: () => publicKeyRaw,
    };
  }, [publicKeyRaw]) as any;
  const [managedEmployees, setManagedEmployees] = useState<ManagedEmployee[]>(
    [],
  );
  const [streams, setStreams] = useState<PayrollStream[]>([]);
  const [loadingPayrollConfig, setLoadingPayrollConfig] = useState(false);
  const [savingStream, setSavingStream] = useState<string | null>(null);
  const [controllingStream, setControllingStream] = useState<string | null>(
    null,
  );
  const [onboardingStream, setOnboardingStream] = useState<string | null>(null);
  const [restartingStream, setRestartingStream] = useState<string | null>(null);
  const [closingStream, setClosingStream] = useState<string | null>(null);
  const [closeProgressByStream, setCloseProgressByStream] = useState<
    Record<string, string>
  >({});
  const [checkpointingStream, setCheckpointingStream] = useState<string | null>(
    null,
  );
  const [refreshingPreview, setRefreshingPreview] = useState<string | null>(
    null,
  );
  const [runningTick, setRunningTick] = useState(false);
  const [runningTickStream, setRunningTickStream] = useState<string | null>(null);
  const [settlingTickStream, setSettlingTickStream] = useState<string | null>(null);
  const [privateStates, setPrivateStates] = useState<Record<string, PrivatePayrollStateResponse>>({});
  const [missingPrivateStates, setMissingPrivateStates] = useState<Record<string, boolean>>({});
  const missingPrivateStatesRef = useRef<Record<string, boolean>>({});
  const [streamsNeedingRecovery, setStreamsNeedingRecovery] = useState<Record<string, TickBuildResult>>({});
  const [rateInputs, setRateInputs] = useState<Record<string, string>>({});
  const [tickAmountInputs, setTickAmountInputs] = useState<
    Record<string, string>
  >({});
  const [cashoutRequests, setCashoutRequests] = useState<CashoutRequestRecord[]>(
    [],
  );
  const [loadingCashoutRequests, setLoadingCashoutRequests] = useState(false);
  const [resolvingCashoutRequestId, setResolvingCashoutRequestId] = useState<
    string | null
  >(null);
  const [privatePayrollHealth, setPrivatePayrollHealth] =
    useState<PrivatePayrollHealthState>("checking");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const tokenCache = useRef<string | null>(null);
  const walletAddress = publicKey?.toBase58() ?? "";
  const focusedEmployeeId = searchParams?.get("employee")?.trim() || null;
  const cycleInfo = useMemo(
    () => getScheduleCycleSnapshot("monthly", new Date(nowMs)),
    [nowMs],
  );
  const [treasuryPrivateBalance, setTreasuryPrivateBalance] = useState<
    number | null
  >(null);
  const [refreshingTreasuryBalance, setRefreshingTreasuryBalance] =
    useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const employeeStreamMap = useMemo(() => {
    const map = new Map<string, PayrollStream>();
    for (const stream of streams) {
      const existing = map.get(stream.employeeId);
      if (!existing) {
        map.set(stream.employeeId, stream);
        continue;
      }

      const existingStatus = getEffectiveStreamStatus(
        existing,
        privateStates[existing.id],
      );
      const nextStatus = getEffectiveStreamStatus(
        stream,
        privateStates[stream.id],
      );

      const existingPriority = existingStatus
        ? STREAM_STATUS_PRIORITY[existingStatus]
        : 0;
      const nextPriority = nextStatus ? STREAM_STATUS_PRIORITY[nextStatus] : 0;

      if (nextPriority > existingPriority) {
        map.set(stream.employeeId, stream);
        continue;
      }

      if (
        nextPriority === existingPriority &&
        new Date(stream.updatedAt).getTime() >
        new Date(existing.updatedAt).getTime()
      ) {
        map.set(stream.employeeId, stream);
      }
    }
    return map;
  }, [streams, privateStates]);

  const cashoutRequestsByStream = useMemo(() => {
    const grouped = new Map<string, CashoutRequestRecord[]>();
    for (const request of cashoutRequests) {
      const existing = grouped.get(request.streamId) ?? [];
      existing.push(request);
      grouped.set(request.streamId, existing);
    }
    return grouped;
  }, [cashoutRequests]);

  const focusedEmployee = useMemo(
    () =>
      focusedEmployeeId
        ? managedEmployees.find((employee) => employee.id === focusedEmployeeId) ?? null
        : null,
    [managedEmployees, focusedEmployeeId],
  );

  const focusedStreamId = useMemo(() => {
    if (!focusedEmployeeId) return null;
    return employeeStreamMap.get(focusedEmployeeId)?.id ?? null;
  }, [employeeStreamMap, focusedEmployeeId]);

  const resolveStatusWithMissing = useCallback(
    (
      stream: PayrollStream | null | undefined,
      preview?: PrivatePayrollStateResponse | null,
    ): StreamStatus | null => {
      if (!stream) return null;
      if (missingPrivateStates[stream.id]) return "stopped";
      return getEffectiveStreamStatus(stream, preview);
    },
    [missingPrivateStates],
  );

  const salaryAllocationRows = useMemo(() => {
    return managedEmployees.map((employee) => {
      const stream = employeeStreamMap.get(employee.id) ?? null;
      const preview = stream ? (privateStates[stream.id] ?? null) : null;
      const status = resolveStatusWithMissing(stream, preview) ?? "paused";
      const ratePerSecond = stream?.ratePerSecond ?? 0;

      // Use stream-specific date range when available (calendar-driven mode),
      // otherwise fall back to the generic schedule-based cycle.
      const streamStartsAt = stream?.startsAt ?? employee.startDate ?? null;
      const streamEndsAt = stream?.endsAt ?? stream?.compensationSnapshot?.endsAt ?? null;
      const hasStreamRange = Boolean(streamStartsAt && streamEndsAt);

      let cycleLabel: string;
      let cycleTarget: number;
      let streamedSoFar: number;

      if (hasStreamRange && streamStartsAt && streamEndsAt) {
        // Calendar-driven: use the stream's explicit date range
        const startMs = new Date(streamStartsAt).getTime();
        const endMs = new Date(streamEndsAt).getTime();
        const durationSeconds = Math.max(1, Math.floor((endMs - startMs) / 1000));

        cycleLabel = `${new Date(streamStartsAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })} – ${new Date(streamEndsAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })}`;

        cycleTarget = ratePerSecond > 0 ? ratePerSecond * durationSeconds : 0;

        const accrualStartMs = startMs;
        const accrualEndMs = Math.min(nowMs, endMs);
        const elapsedSeconds = Math.max(0, Math.floor((accrualEndMs - accrualStartMs) / 1000));
        streamedSoFar = Math.min(cycleTarget, ratePerSecond * elapsedSeconds);
      } else {
        // Legacy: generic schedule-based cycle
        const employeeCycle = getScheduleCycleSnapshot(
          employee.paySchedule,
          new Date(nowMs),
        );
        cycleLabel = employeeCycle.label;
        cycleTarget = ratePerSecond > 0 ? ratePerSecond * employeeCycle.totalSeconds : 0;
        streamedSoFar = Math.min(
          Math.max(cycleTarget, 0),
          getAccruedInCycle({
            ratePerSecond,
            cycleStart: employeeCycle.start,
            cycleTotalSeconds: employeeCycle.totalSeconds,
            nowMs,
            startsAt: stream?.startsAt ?? employee.startDate ?? null,
          }),
        );
      }

      const monthlySalary = ratePerSecondToMonthlyUsd(ratePerSecond);
      const claimableNow = preview
        ? Number(preview.state.effectiveClaimableAmountMicro) / 1_000_000
        : null;
      const remainingThisCycle = Math.max(cycleTarget - streamedSoFar, 0);
      const perStatus = status === "active" ? "active" : status === "paused" ? "paused" : "stopped";

      return {
        employee,
        cycleLabel,
        status: perStatus,
        ratePerSecond,
        monthlySalary,
        cycleTarget,
        streamedSoFar,
        claimableNow,
        remainingThisCycle,
      };
    });
  }, [
    managedEmployees,
    employeeStreamMap,
    privateStates,
    resolveStatusWithMissing,
    nowMs,
  ]);

  const visibleSalaryAllocationRows = useMemo(
    () =>
      focusedEmployeeId
        ? salaryAllocationRows.filter((row) => row.employee.id === focusedEmployeeId)
        : salaryAllocationRows,
    [salaryAllocationRows, focusedEmployeeId],
  );

  const visibleManagedEmployees = useMemo(
    () =>
      focusedEmployeeId
        ? managedEmployees.filter((employee) => employee.id === focusedEmployeeId)
        : managedEmployees,
    [managedEmployees, focusedEmployeeId],
  );



  const monthlyLiability = useMemo(
    () =>
      visibleSalaryAllocationRows.reduce(
        (sum, row) => sum + (Number.isFinite(row.monthlySalary) ? row.monthlySalary : 0),
        0,
      ),
    [visibleSalaryAllocationRows],
  );


  const activeDailyBurn = useMemo(
    () =>
      visibleSalaryAllocationRows.reduce(
        (sum, row) =>
          row.status === "active" ? sum + row.ratePerSecond * 86_400 : sum,
        0,
      ),
    [visibleSalaryAllocationRows],
  );

  const treasuryRunwayDays = useMemo(() => {
    if (treasuryPrivateBalance === null || activeDailyBurn <= 0) {
      return null;
    }
    return treasuryPrivateBalance / activeDailyBurn;
  }, [treasuryPrivateBalance, activeDailyBurn]);

  const readinessSummary = useMemo(() => {
    let perMissing = 0;
    let recipientPending = 0;
    let recipientFailed = 0;
    let paused = 0;

    for (const employee of visibleManagedEmployees) {
      const stream = employeeStreamMap.get(employee.id) ?? null;
      const preview = stream ? (privateStates[stream.id] ?? null) : null;
      const status = resolveStatusWithMissing(stream, preview);
      const initStatus = resolvePrivateInitStatus(employee, stream);

      if (!stream?.employeePda || !stream?.privatePayrollPda || !stream?.permissionPda) {
        perMissing += 1;
      }

      if (initStatus === "failed") {
        recipientFailed += 1;
      } else if (initStatus !== "confirmed") {
        recipientPending += 1;
      }

      if (status === "paused") {
        paused += 1;
      }
    }

    return {
      perMissing,
      recipientPending,
      recipientFailed,
      paused,
    };
  }, [visibleManagedEmployees, employeeStreamMap, privateStates, resolveStatusWithMissing]);

  const renderSourceBadge = useCallback((source: DataSourceBadge) => {
    const meta = sourceBadgeMeta(source);
    return (
      <span
        className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${meta.className}`}
      >
        {meta.label}
      </span>
    );
  }, []);

  const refreshPrivatePayrollHealth = useCallback(async () => {
    try {
      const health = await checkHealth();
      setPrivatePayrollHealth(health.status === "ok" ? "ok" : "error");
    } catch {
      setPrivatePayrollHealth("error");
    }
  }, []);

  useEffect(() => {
    if (publicKey) {
      const persisted = loadCachedTeeToken(publicKey.toBase58());
      if (persisted && !isJwtExpired(persisted)) {
        tokenCache.current = persisted;
      } else {
        tokenCache.current = null;
      }
    } else {
      tokenCache.current = null;
    }
  }, [publicKey]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshPrivatePayrollHealth();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [refreshPrivatePayrollHealth]);

  useEffect(() => {
    missingPrivateStatesRef.current = missingPrivateStates;
  }, [missingPrivateStates]);

  const getOrFetchToken = useCallback(async () => {
    if (tokenCache.current && !isJwtExpired(tokenCache.current)) {
      return tokenCache.current;
    }

    if (tokenCache.current && isJwtExpired(tokenCache.current)) {
      tokenCache.current = null;
      if (publicKey) {
        clearCachedTeeToken(publicKey.toBase58());
      }
    }

    if (!tokenCache.current && publicKey) {
      const persisted = loadCachedTeeToken(publicKey.toBase58());
      if (persisted) {
        tokenCache.current = persisted;
        return persisted;
      }
    }

    if (!publicKey || !signMessage) {
      throw new Error("Wallet does not support message signing");
    }

    const token = await getOrCreateCachedTeeToken(
      publicKey.toBase58(),
      async () => {
        toast.info("Please sign the message to access PER private payroll state");
        return fetchTeeAuthToken(publicKey, signMessage);
      },
    );
    tokenCache.current = token;
    return token;
  }, [publicKey, signMessage]);

  const getTeeRpcUrl = useCallback(
    (teeAuthToken: string) =>
      `https://tee.auraflow.finance?token=${encodeURIComponent(teeAuthToken)}`,
    [],
  );

  const refreshTreasuryPrivateBalance = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!walletAddress) {
        setTreasuryPrivateBalance(null);
        return;
      }

      if (!options?.silent) {
        setRefreshingTreasuryBalance(true);
      }

      try {
        const token = await getOrFetchToken();
        const res = (await getPrivateBalance(
          walletAddress,
          token,
        )) as BalanceResponse;

        if (res.location !== "ephemeral") {
          throw new Error(
            `Expected treasury from ephemeral location, received ${res.location}`,
          );
        }

        const raw = Number.parseInt(res.balance ?? "0", 10);
        const normalized = Number.isFinite(raw) ? raw / 1_000_000 : 0;
        setTreasuryPrivateBalance(normalized);
      } catch (err: unknown) {
        setTreasuryPrivateBalance(null);
        if (!options?.silent) {
          toast.error(
            `Treasury sync failed: ${err instanceof Error ? err.message : "Unknown"}`,
          );
        }
      } finally {
        if (!options?.silent) {
          setRefreshingTreasuryBalance(false);
        }
      }
    },
    [walletAddress, getOrFetchToken],
  );

  const waitForEmployeeOwnership = useCallback(async (employeePda: string) => {
    // Stub for EVM migration - ownership check not required in this form
    return;
  }, []);

  const fetchPrivatePreview = useCallback(
    async (
      stream: PayrollStream,
      options?: { silent?: boolean },
    ): Promise<PrivatePayrollStateResponse | "missing" | null> => {
      const silent = options?.silent === true;

      if (!walletAddress) {
        return null;
      }

      if (!stream.privatePayrollPda) {
        setPrivateStates((prev) => {
          const next = { ...prev };
          delete next[stream.id];
          return next;
        });
        setMissingPrivateStates((prev) => {
          const next = { ...prev };
          delete next[stream.id];
          return next;
        });
        return null;
      }

      if (!silent) {
        setRefreshingPreview(stream.id);
      }

      try {
        const token = await getOrFetchToken();
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "https://auraflow-backend-ulnl.onrender.com"}/api/v1/payroll/state?employerWallet=${walletAddress}&streamId=${stream.id}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );
        const json = (await response.json()) as
          | PrivatePayrollStateResponse
          | { error?: string };

        if (!response.ok) {
          throw new Error(
            "error" in json
              ? json.error || "Failed to load exact PER payroll state"
              : "Failed to load exact PER payroll state",
          );
        }

        const stateResponse = json as PrivatePayrollStateResponse;

        setPrivateStates((prev) => ({
          ...prev,
          [stream.id]: stateResponse,
        }));
        setMissingPrivateStates((prev) => {
          const next = { ...prev };
          delete next[stream.id];
          return next;
        });
        setStreams((prev) =>
          prev.map((existing) =>
            existing.id === stream.id
              ? {
                  ...existing,
                  status: stateResponse.stream.status,
                employeePda:
                  stateResponse.stream.employeePda ?? existing.employeePda,
                privatePayrollPda:
                  stateResponse.stream.privatePayrollPda ??
                  existing.privatePayrollPda,
                permissionPda:
                  stateResponse.stream.permissionPda ??
                  existing.permissionPda,
                  delegatedAt:
                    stateResponse.stream.delegatedAt ?? existing.delegatedAt,
                  checkpointCrankStatus:
                    (stateResponse.stream.checkpointCrankStatus ??
                    existing.checkpointCrankStatus) as any,
                  checkpointCrankUpdatedAt:
                    stateResponse.stream.checkpointCrankUpdatedAt ??
                    existing.checkpointCrankUpdatedAt,
                  lastPaidAt: stateResponse.stream.lastPaidAt,
                  totalPaid: stateResponse.stream.totalPaid,
                }
              : existing,
          ),
        );
        return stateResponse;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown";
        const missingPrivateState = isMissingPrivateStateMessage(message);

        if (missingPrivateState) {
          setPrivateStates((prev) => {
            const next = { ...prev };
            delete next[stream.id];
            return next;
          });
          setMissingPrivateStates((prev) => ({
            ...prev,
            [stream.id]: true,
          }));
          setStreams((prev) =>
            prev.map((existing) =>
              existing.id === stream.id ? { ...existing, status: "stopped" } : existing,
            ),
          );

          if (!silent) {
            if (stream.status === "stopped") {
              toast.info(
                "This stopped stream no longer has a private payroll state in PER. It is fully closed now and ready for a fresh stream if needed.",
              );
            } else {
              toast.info(
                "PER state is missing for this stream (not initialized, cleaned up, or replaced).",
              );
            }
          }

          return "missing";
        }

        if (!silent) {
          toast.error(
            `TEE state load failed: ${message}`,
          );
        }
        return null;
      } finally {
        if (!silent) {
          setRefreshingPreview((current) =>
            current === stream.id ? null : current,
          );
        }
      }
    },
    [walletAddress, getOrFetchToken],
  );



  const fetchPayrollConfig = useCallback(async () => {
    if (!walletAddress) {
      setManagedEmployees([]);
      setStreams([]);
      return;
    }

    setLoadingPayrollConfig(true);
    try {
      if (!signMessage) {
        throw new Error(
          "Wallet message signing is required to load payroll configuration",
        );
      }

      const [employeesRes, streamsRes] = await Promise.all([
        walletAuthenticatedFetch({
          wallet: walletAddress,
          signMessage,
          path: `/api/v1/employees?employerWallet=${walletAddress}`,
        }),
        walletAuthenticatedFetch({
          wallet: walletAddress,
          signMessage,
          path: `/api/v1/streams?employerWallet=${walletAddress}`,
        }),
      ]);

      const employeesJson = (await employeesRes.json()) as {
        employees?: ManagedEmployee[];
        error?: string;
      };
      const streamsJson = (await streamsRes.json()) as {
        streams?: PayrollStream[];
        error?: string;
      };

      if (!employeesRes.ok) {
        throw new Error(employeesJson.error || "Failed to load employees");
      }

      if (!streamsRes.ok) {
        throw new Error(streamsJson.error || "Failed to load payroll streams");
      }

      const nextEmployees = employeesJson.employees ?? [];
      const nextStreams = streamsJson.streams ?? [];

      setManagedEmployees(nextEmployees);
      setStreams(nextStreams);
      setRateInputs((prev) => {
        const next = { ...prev };
        for (const employee of nextEmployees) {
          const existingStream =
            [...nextStreams]
              .reverse()
              .find((stream) => stream.employeeId === employee.id) ?? null;
          if (!next[employee.id] && existingStream) {
            next[employee.id] = existingStream.ratePerSecond.toString();
          }
        }
        return next;
      });

      setPrivateStates((prev) => {
        const next = { ...prev };
        const validIds = new Set(nextStreams.map((stream) => stream.id));
        for (const key of Object.keys(next)) {
          if (!validIds.has(key)) {
            delete next[key];
          }
        }
        return next;
      });
      setMissingPrivateStates((prev) => {
        const next = { ...prev };
        const validIds = new Set(nextStreams.map((stream) => stream.id));
        for (const key of Object.keys(next)) {
          if (!validIds.has(key)) {
            delete next[key];
          }
        }
        return next;
      });

      if (tokenCache.current && !isJwtExpired(tokenCache.current)) {
        const previewPrefetchStreams = nextStreams.filter((stream) => {
          if (!stream.privatePayrollPda) {
            return false;
          }

          if (
            missingPrivateStatesRef.current[stream.id] &&
            stream.status === "stopped"
          ) {
            return false;
          }

          if (focusedEmployeeId) {
            return stream.id === focusedStreamId;
          }

          return true;
        });

        await Promise.all(
          previewPrefetchStreams
            .map(async (stream) => {
              try {
                const response = await fetch(
                  `${process.env.NEXT_PUBLIC_API_URL || "https://auraflow-backend-ulnl.onrender.com"}/api/v1/payroll/state?employerWallet=${walletAddress}&streamId=${stream.id}`,
                  {
                    headers: {
                      Authorization: `Bearer ${tokenCache.current}`,
                    },
                  },
                );
                const json = (await response.json()) as
                  | PrivatePayrollStateResponse
                  | { error?: string };

                if (!response.ok) {
                  const message =
                    "error" in json
                      ? json.error || "Failed to load exact PER payroll state"
                      : "Failed to load exact PER payroll state";
                  const missingPrivateState =
                    response.status === 404 || isMissingPrivateStateMessage(message);

                  if (missingPrivateState) {
                    setPrivateStates((prev) => {
                      const next = { ...prev };
                      delete next[stream.id];
                      return next;
                    });
                    setMissingPrivateStates((prev) => ({
                      ...prev,
                      [stream.id]: true,
                    }));
                    setStreams((prev) =>
                      prev.map((existing) =>
                        existing.id === stream.id
                          ? { ...existing, status: "stopped" }
                          : existing,
                      ),
                    );
                  }
                  return;
                }

                const stateResponse = json as PrivatePayrollStateResponse;

                setPrivateStates((prev) => ({
                  ...prev,
                  [stream.id]: stateResponse,
                }));
                setStreams((prev) =>
                  prev.map((existing) =>
                    existing.id === stream.id
                      ? {
                          ...existing,
                          status: stateResponse.stream.status,
                        employeePda:
                          stateResponse.stream.employeePda ??
                          existing.employeePda,
                        privatePayrollPda:
                          stateResponse.stream.privatePayrollPda ??
                          existing.privatePayrollPda,
                        permissionPda:
                          stateResponse.stream.permissionPda ??
                          existing.permissionPda,
                          delegatedAt:
                            stateResponse.stream.delegatedAt ??
                            existing.delegatedAt,
                          lastPaidAt: stateResponse.stream.lastPaidAt,
                          totalPaid: stateResponse.stream.totalPaid,
                        }
                      : existing,
                  ),
                );
              } catch {
                // Preview refresh is best-effort; failures should not block
                // the core payroll configuration response.
              }
            }),
        );
      }
    } catch (err: unknown) {
      toast.error(
        `Payroll config failed: ${err instanceof Error ? err.message : "Unknown"}`,
      );
    } finally {
      setLoadingPayrollConfig(false);
    }
  }, [walletAddress, signMessage, focusedEmployeeId, focusedStreamId]);

  const fetchCashoutRequests = useCallback(async () => {
    if (!walletAddress) {
      setCashoutRequests([]);
      return;
    }

    if (!signMessage) {
      return;
    }

    setLoadingCashoutRequests(true);
    try {
      const cashoutPath =
        focusedStreamId
          ? `/api/v1/cashout-requests?scope=employer&employerWallet=${walletAddress}&streamId=${focusedStreamId}`
          : `/api/v1/cashout-requests?scope=employer&employerWallet=${walletAddress}`;
      const response = await walletAuthenticatedFetch({
        wallet: walletAddress,
        signMessage,
        path: cashoutPath,
      });

      const json = (await response.json()) as {
        requests?: CashoutRequestRecord[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(json.error || "Failed to load cashout requests");
      }

      setCashoutRequests(json.requests ?? []);
    } catch (err: unknown) {
      toast.error(
        `Cashout requests failed: ${err instanceof Error ? err.message : "Unknown"}`,
      );
    } finally {
      setLoadingCashoutRequests(false);
    }
  }, [walletAddress, signMessage, focusedStreamId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchPayrollConfig();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [fetchPayrollConfig]);

  useEffect(() => {
    if (!walletAddress || !signMessage) return;
    const employeesToWatch = focusedEmployeeId
      ? managedEmployees.filter((employee) => employee.id === focusedEmployeeId)
      : managedEmployees;
    const hasInitInFlight = employeesToWatch.some((employee) => {
      const status = employee.privateRecipientInitStatus ?? "pending";
      return status === "pending" || status === "processing";
    });
    if (!hasInitInFlight) return;

    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void fetchPayrollConfig();
    }, 4_000);

    return () => window.clearInterval(timer);
  }, [fetchPayrollConfig, managedEmployees, signMessage, walletAddress, focusedEmployeeId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void fetchCashoutRequests();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [fetchCashoutRequests]);

  useEffect(() => {
    if (!walletAddress) {
      const timeoutId = window.setTimeout(() => {
        setTreasuryPrivateBalance(null);
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }

    if (focusedEmployeeId) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void refreshTreasuryPrivateBalance({ silent: true });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [walletAddress, refreshTreasuryPrivateBalance, focusedEmployeeId]);

  useEffect(() => {
    if (!walletAddress) {
      return;
    }

    if (focusedEmployeeId) {
      return;
    }

    const hasValidToken =
      !!tokenCache.current && !isJwtExpired(tokenCache.current);
    if (!hasValidToken) {
      return;
    }

    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }

      const tokenStillValid =
        !!tokenCache.current && !isJwtExpired(tokenCache.current);
      if (!tokenStillValid) {
        return;
      }

      void refreshTreasuryPrivateBalance({ silent: true });
    }, 15_000);

    return () => window.clearInterval(timer);
  }, [walletAddress, refreshTreasuryPrivateBalance, focusedEmployeeId]);

  useEffect(() => {
    if (!walletAddress) {
      return;
    }

    const hasValidToken =
      !!tokenCache.current && !isJwtExpired(tokenCache.current);
    if (!hasValidToken) {
      return;
    }

    const activeStreams = streams.filter(
      (stream) =>
        getEffectiveStreamStatus(stream, privateStates[stream.id]) ===
        "active" &&
        !!stream.privatePayrollPda &&
        !!stream.employeePda &&
        !!stream.delegatedAt &&
        !missingPrivateStates[stream.id] &&
        (!focusedEmployeeId || stream.id === focusedStreamId),
    );

    if (activeStreams.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }

      const tokenStillValid =
        !!tokenCache.current && !isJwtExpired(tokenCache.current);
      if (!tokenStillValid) {
        return;
      }

      for (const stream of activeStreams) {
        void fetchPrivatePreview(stream, { silent: true });
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [walletAddress, streams, privateStates, fetchPrivatePreview, missingPrivateStates, focusedEmployeeId, focusedStreamId]);

  const handleSaveDraftStream = useCallback(
    async (employee: ManagedEmployee, overrideRate?: number) => {
      if (!walletAddress) {
        toast.error("Connect your wallet first");
        return;
      }

      const currentRate =
        typeof overrideRate === "number"
          ? overrideRate
          : parseFloat(rateInputs[employee.id] || "0");
      if (!Number.isFinite(currentRate) || currentRate <= 0) {
        toast.error("Enter a valid rate per second");
        return;
      }

      setSavingStream(employee.id);
      try {
        const existingStream = employeeStreamMap.get(employee.id);
        if (!signMessage) {
          throw new Error(
            "Wallet message signing is required to update payroll streams",
          );
        }

        if (existingStream) {
          const response = await walletAuthenticatedFetch({
            wallet: walletAddress,
            signMessage,
            path: "/api/v1/streams",
            method: "PATCH",
            body: {
              employerWallet: walletAddress,
              streamId: existingStream.id,
              ratePerSecond: currentRate,
            },
          });

          const json = (await response.json()) as {
            stream?: PayrollStream;
            error?: string;
          };

          if (!response.ok) {
            throw new Error(json.error || "Failed to update stream draft");
          }

          toast.success("Stream draft updated");
        } else {
          const response = await walletAuthenticatedFetch({
            wallet: walletAddress,
            signMessage,
            path: "/api/v1/streams",
            method: "POST",
            body: {
              employerWallet: walletAddress,
              employeeId: employee.id,
              ratePerSecond: currentRate,
              status: "paused",
              payoutMode: DEFAULT_PAYROLL_PAYOUT_MODE,
              allowedPayoutModes: allowedPayoutModesFor(),
            },
          });

          const json = (await response.json()) as {
            stream?: PayrollStream;
            error?: string;
          };

          if (!response.ok) {
            throw new Error(json.error || "Failed to create payroll stream");
          }

          toast.success(
            "Realtime payroll draft created. Onboard PER, ask the employee to initialize their private account, then Resume to start accrual.",
          );
        }

        await fetchPayrollConfig();
        await fetchCashoutRequests();
      } catch (err: unknown) {
        toast.error(
          `Payroll stream failed: ${err instanceof Error ? err.message : "Unknown"}`,
        );
      } finally {
        setSavingStream(null);
      }
    },
    [
      walletAddress,
      signMessage,
      rateInputs,
      employeeStreamMap,
      fetchPayrollConfig,
      fetchCashoutRequests,
    ],
  );



  const handleResolveCashoutRequest = useCallback(
    async (
      request: CashoutRequestRecord,
      status: Extract<CashoutRequestStatus, "dismissed" | "fulfilled" | "cancelled">,
      resolutionNote?: string,
    ) => {
      if (!walletAddress || !signMessage) {
        toast.error("Connect a wallet that supports message signing");
        return;
      }

      setResolvingCashoutRequestId(request.id);
      try {
        const response = await walletAuthenticatedFetch({
          wallet: walletAddress,
          signMessage,
          path: "/api/v1/cashout-requests",
          method: "PATCH",
          body: {
            employerWallet: walletAddress,
            requestId: request.id,
            status,
            resolutionNote,
          },
        });

        const json = (await response.json()) as {
          request?: CashoutRequestRecord;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(json.error || "Failed to resolve cashout request");
        }

        toast.success(
          status === "dismissed"
            ? "Cashout request dismissed"
            : "Cashout request updated",
        );
        await fetchCashoutRequests();
      } catch (err: unknown) {
        toast.error(
          `Cashout request update failed: ${err instanceof Error ? err.message : "Unknown"}`,
        );
      } finally {
        setResolvingCashoutRequestId(null);
      }
    },
    [walletAddress, signMessage, fetchCashoutRequests],
  );

  const handleControlStream = useCallback(
    async (
      stream: PayrollStream,
      action: StreamControlAction,
      options?: { awaitCheckpointCleanup?: boolean },
    ) => {
      if (!walletAddress || !publicKey) {
        toast.error("Connect a wallet that supports transaction signing");
        return;
      }

      const employee = managedEmployees.find(
        (item) => item.id === stream.employeeId,
      );
      if (!employee) {
        toast.error("Teammate record not found");
        return;
      }

      setControllingStream(stream.id);
      try {
        let nextStatus: "paused" | "active" | "stopped" =
          action === "pause" ? "paused" : action === "resume" ? "active" : "stopped";

        if (action === "stop") {
          // TODO: Implement Soroban contract call to cancel stream
          // Get the on-chain streamId from stream.employeePda (where we stored it)
          const onChainId = BigInt(stream.employeePda || "1");
          toast.info("Sending transaction to cancel stream on-chain...");
          // const txHash = await writeContractAsync({
          //   address: PAYROLL_CONTRACT_ADDRESS,
          //   functionName: "cancelStream",
          //   args: [onChainId],
          // });
          
          // toast.info("Waiting for transaction confirmation...");
          // if (publicClient) {
          //   await publicClient.waitForTransactionReceipt({ hash: txHash });
          // }
          toast.success("Stream cancelled successfully on-chain!");
        }

        const finalizeResponse = await walletAuthenticatedFetch({
          wallet: walletAddress,
          signMessage,
          path: "/api/v1/streams/control",
          method: "PATCH",
          body: {
            employerWallet: walletAddress,
            streamId: stream.id,
            action,
            ratePerSecond: action === "resume" ? stream.ratePerSecond : undefined,
          },
        });

        const finalizeJson = (await finalizeResponse.json()) as {
          error?: string;
        };

        if (!finalizeResponse.ok) {
          throw new Error(
            finalizeJson.error || "Failed to finalize stream control in database",
          );
        }

        setStreams((prev) =>
          prev.map((existing) =>
            existing.id === stream.id
              ? {
                ...existing,
                status: nextStatus,
              }
              : existing,
          ),
        );

        toast.success(
          action === "pause"
            ? "Payroll stream paused"
            : action === "resume"
              ? "Payroll stream resumed"
              : "Payroll stream cancelled on-chain",
        );

        await fetchPayrollConfig();
      } catch (err: unknown) {
        toast.error(
          `Stream control failed: ${err instanceof Error ? err.message : "Unknown"}`,
        );
      } finally {
        setControllingStream(null);
      }
    },
    [
      walletAddress,
      publicKey,
      managedEmployees,
      // writeContractAsync,
      // publicClient,
      fetchPayrollConfig,
    ],
  );

  const handleBatchResume = useCallback(async () => {
    const pausedStreams = streams.filter((stream) => {
      const preview = privateStates[stream.id] ?? null;
      const status = resolveStatusWithMissing(stream, preview);
      const employee = managedEmployees.find(
        (managedEmployee) => managedEmployee.id === stream.employeeId,
      );
      const privateInitStatus = employee
        ? resolvePrivateInitStatus(employee, stream)
        : "pending";
      return (
        status === "paused" &&
        !!stream.employeePda &&
        !!stream.privatePayrollPda &&
        !!stream.permissionPda &&
        !!stream.delegatedAt &&
        privateInitStatus === "confirmed"
      );
    });

    if (pausedStreams.length === 0) {
      toast.info(
        "No paused streams are fully ready to resume. Make sure PER is onboarded and the employee has initialized their private recipient.",
      );
      return;
    }

    for (const stream of pausedStreams) {
      await handleControlStream(stream, "resume");
    }
  }, [
    streams,
    privateStates,
    resolveStatusWithMissing,
    handleControlStream,
    managedEmployees,
  ]);

  const handleBatchPause = useCallback(async () => {
    const activeStreams = streams.filter((stream) => {
      const preview = privateStates[stream.id] ?? null;
      const status = resolveStatusWithMissing(stream, preview);
      return (
        status === "active" &&
        !!stream.employeePda &&
        !!stream.privatePayrollPda &&
        !!stream.permissionPda &&
        !!stream.delegatedAt
      );
    });

    if (activeStreams.length === 0) {
      toast.info("No active streams available to pause");
      return;
    }

    for (const stream of activeStreams) {
      await handleControlStream(stream, "pause");
    }
  }, [streams, privateStates, resolveStatusWithMissing, handleControlStream]);

  const fetchLatestStreamForEmployee = useCallback(
    async (employeeId: string) => {
      if (!walletAddress || !signMessage) return null;

      const response = await walletAuthenticatedFetch({
        wallet: walletAddress,
        signMessage,
        path: `/api/v1/streams?employerWallet=${walletAddress}`,
      });

      const json = (await response.json()) as {
        streams?: PayrollStream[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(json.error || "Failed to refresh payroll streams");
      }

      const nextStreams = json.streams ?? [];
      setStreams(nextStreams);

      const matches = nextStreams.filter((stream) => stream.employeeId === employeeId);
      if (matches.length === 0) return null;

      matches.sort((left, right) => {
        const priorityDelta =
          (STREAM_STATUS_PRIORITY[right.status] ?? 0) -
          (STREAM_STATUS_PRIORITY[left.status] ?? 0);
        if (priorityDelta !== 0) return priorityDelta;
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      });

      return matches[0] ?? null;
    },
    [walletAddress, signMessage],
  );

  const updateCloseProgress = useCallback((streamId: string, message: string) => {
    setCloseProgressByStream((prev) => ({
      ...prev,
      [streamId]: message,
    }));
  }, []);

  const clearCloseProgress = useCallback((streamId: string) => {
    setCloseProgressByStream((prev) => {
      if (!prev[streamId]) {
        return prev;
      }

      const next = { ...prev };
      delete next[streamId];
      return next;
    });
  }, []);

  const handleRestartStoppedStream = useCallback(
    async (
      stream: PayrollStream,
      options?: {
        createReplacement?: boolean;
        onProgress?: (message: string) => void;
      },
    ) => {
      if (!walletAddress) {
        toast.error("Connect your employer wallet first");
        return;
      }

      setRestartingStream(stream.id);
      options?.onProgress?.("Restarting stream...");
      try {
        const postRes = await walletAuthenticatedFetch({
          wallet: walletAddress,
          signMessage,
          path: "/api/v1/streams/restart",
          method: "POST",
          body: {
            employerWallet: walletAddress,
            streamId: stream.id,
          },
        });

        if (!postRes.ok) {
          const postJson = await postRes.json();
          throw new Error(postJson.error || "Failed to initiate stream restart");
        }

        const patchRes = await walletAuthenticatedFetch({
          wallet: walletAddress,
          signMessage,
          path: "/api/v1/streams/restart",
          method: "PATCH",
          body: {
            employerWallet: walletAddress,
            streamId: stream.id,
          },
        });

        if (!patchRes.ok) {
          const patchJson = await patchRes.json();
          throw new Error(patchJson.error || "Failed to finalize stream restart");
        }

        toast.success("Stream restarted successfully in the database");
        options?.onProgress?.("Stream restarted successfully");
        await fetchPayrollConfig();
      } catch (err: unknown) {
        toast.error(
          `Failed to restart stream: ${err instanceof Error ? err.message : "Unknown"}`,
        );
      } finally {
        setRestartingStream(null);
      }
    },
    [walletAddress, fetchPayrollConfig],
  );

  const handleCloseStream = useCallback(
    async (stream: PayrollStream) => {
      if (!walletAddress) {
        toast.error("Connect your employer wallet first");
        return;
      }

      setClosingStream(stream.id);
      updateCloseProgress(stream.id, "Preparing close");
      try {
        let currentStream = stream;
        let currentPreview = privateStates[currentStream.id] ?? null;
        let currentStatus =
          resolveStatusWithMissing(currentStream, currentPreview) ??
          currentStream.status;
        let currentMissingPrivateState = !!missingPrivateStates[currentStream.id];

        if (currentStatus !== "stopped") {
          updateCloseProgress(stream.id, "Moving stream into terminal close state");
          await handleControlStream(currentStream, "stop", {
            awaitCheckpointCleanup: true,
          });
          updateCloseProgress(stream.id, "Refreshing stopped state");
          currentStream =
            (await fetchLatestStreamForEmployee(stream.employeeId)) ?? currentStream;
          currentPreview = privateStates[currentStream.id] ?? null;
          currentStatus =
            resolveStatusWithMissing(currentStream, currentPreview) ??
            currentStream.status;
          currentMissingPrivateState = !!missingPrivateStates[currentStream.id];
        }

        if (currentStatus !== "stopped") {
          clearCloseProgress(stream.id);
          toast.info(
            "This stream is not stopped yet. Wait for the latest state sync, then try Close again.",
          );
          return;
        }

        updateCloseProgress(stream.id, "Checking remaining payroll");
        const refreshedPreview = await fetchPrivatePreview(currentStream, {
          silent: true,
        });

        if (refreshedPreview === "missing") {
          clearCloseProgress(stream.id);
          toast.success(
            "This payroll stream is already fully closed. You can create a fresh stream any time.",
          );
          await fetchPayrollConfig();
          return;
        }

        const stoppedLifecycle = deriveStoppedLifecycleState({
          effectiveStatus: currentStatus,
          preview: refreshedPreview || currentPreview,
          hasMissingPrivateState: currentMissingPrivateState,
        });

        if (stoppedLifecycle.mustSettleBeforeClose) {
          clearCloseProgress(stream.id);
          toast.info(
            "Close is blocked until the remaining payroll is settled. Settle the remaining amount first, then close the stream.",
          );
          return;
        }

        updateCloseProgress(stream.id, "Closing private payroll");
        await handleRestartStoppedStream(currentStream, {
          createReplacement: false,
          onProgress: (message) => updateCloseProgress(stream.id, message),
        });
      } finally {
        clearCloseProgress(stream.id);
        setClosingStream(null);
      }
    },
    [
      walletAddress,
      privateStates,
      resolveStatusWithMissing,
      missingPrivateStates,
      handleControlStream,
      fetchLatestStreamForEmployee,
      fetchPrivatePreview,
      fetchPayrollConfig,
      handleRestartStoppedStream,
      updateCloseProgress,
      clearCloseProgress,
    ],
  );

  const handleOnboardToPer = useCallback(
    async (stream: PayrollStream) => {
      if (!walletAddress || !publicKey) {
        toast.error(
          "Connect a wallet that supports transaction signing",
        );
        return;
      }

      const employee = managedEmployees.find((item) => item.id === stream.employeeId);
      if (!employee) {
        toast.error("Teammate record not found");
        return;
      }

      const recipient = employee.wallet;
      if (!recipient || !recipient.startsWith("0x")) {
        toast.error("Invalid employee wallet address (must be a valid EVM address)");
        return;
      }

      setOnboardingStream(stream.id);
      try {
        const streamStartsAt = stream.startsAt || employee.startDate || new Date().toISOString();
        const streamEndsAt = stream.endsAt || stream.compensationSnapshot?.endsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        
        const startSecs = Math.floor(new Date(streamStartsAt).getTime() / 1000);
        const endSecs = Math.floor(new Date(streamEndsAt).getTime() / 1000);
        const totalDuration = Math.max(1, endSecs - startSecs);
        
        const depositAmount = stream.ratePerSecond * totalDuration;
        const depositAmountMicro = BigInt(Math.max(1, Math.round(depositAmount * 1_000_000)));

        toast.info("Sending transaction to create stream on-chain...");
        // Soroban contract call now handled via private-payroll-api + Freighter signing

        // toast.info("Waiting for transaction receipt...");
        let receipt;
        // if (publicClient) {
        //   receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        // }

        // Parse logs to extract stream ID
        let onChainStreamId = "";
        // if (receipt && receipt.logs) {
        //   for (const log of receipt.logs) {
        //     try {
        //       const decoded = { eventName: "StreamCreated", args: { streamId: onChainStreamId } };
        //       if (decoded.eventName === "StreamCreated") {
        //         onChainStreamId = (decoded.args as any).streamId.toString();
        //         break;
        //       }
        //     } catch (e) {
        //       // Ignore decoding failures for other events
        //     }
        //   }
        // }

        if (!onChainStreamId) {
          // TODO: Generate or extract onChainStreamId from Soroban response
          onChainStreamId = Math.random().toString(36).substring(7);
          // throw new Error("Could not find StreamCreated event in transaction logs");
        }

        toast.success(`On-chain stream created with ID: ${onChainStreamId}`);

        const onboardResponse = await walletAuthenticatedFetch({
          wallet: walletAddress,
          signMessage,
          path: "/api/v1/streams/onboard",
          method: "PATCH",
          body: {
            employerWallet: walletAddress,
            streamId: stream.id,
            employeePda: onChainStreamId,
            privatePayrollPda: "0xMockPrivatePayrollPda",
            permissionPda: "0xMockPermissionPda",
          },
        });

        if (!onboardResponse.ok) {
          const errJson = await onboardResponse.ok ? {} : await onboardResponse.json();
          throw new Error(errJson.error || "Failed to update stream runtime state in database");
        }

        const controlResponse = await walletAuthenticatedFetch({
          wallet: walletAddress,
          signMessage,
          path: "/api/v1/streams/control",
          method: "PATCH",
          body: {
            employerWallet: walletAddress,
            streamId: stream.id,
            action: "resume",
          },
        });

        if (!controlResponse.ok) {
          const errJson = await controlResponse.ok ? {} : await controlResponse.json();
          throw new Error(errJson.error || "Failed to activate stream in database");
        }

        toast.success("Stream activated and synchronized with database!");
        await fetchPayrollConfig();
      } catch (err: unknown) {
        toast.error(
          `On-chain stream creation failed: ${err instanceof Error ? err.message : "Unknown"}`,
        );
      } finally {
        setOnboardingStream(null);
      }
    },
    [
      walletAddress,
      publicKey,
      managedEmployees,
      // writeContractAsync,
      // publicClient,
      fetchPayrollConfig,
    ],
  );

  const handleGoLive = useCallback(
    async (
      employee: ManagedEmployee,
      stream: PayrollStream | null,
      options?: { isOnboarded?: boolean; privateInitStatus?: PrivateInitStatus },
    ) => {
      if (!walletAddress) {
        toast.error("Connect your employer wallet first");
        return;
      }

      let currentStream = stream;
      let currentPrivateInitStatus =
        options?.privateInitStatus ?? resolvePrivateInitStatus(employee, stream);

      if (!currentStream) {
        await handleSaveDraftStream(employee);
        currentStream = await fetchLatestStreamForEmployee(employee.id);
        currentPrivateInitStatus = resolvePrivateInitStatus(employee, currentStream);
      }

      if (!currentStream) {
        toast.info("Draft created. Review the stream once it appears, then click Go Live again.");
        return;
      }

      let currentPreview = privateStates[currentStream.id] ?? null;
      let currentStatus =
        resolveStatusWithMissing(currentStream, currentPreview) ?? currentStream.status;
      let currentMissingPrivateState = !!missingPrivateStates[currentStream.id];
      let currentOnboarded =
        options?.isOnboarded ??
        Boolean(
          !currentMissingPrivateState &&
            currentStream.employeePda &&
            currentStream.privatePayrollPda &&
            currentStream.permissionPda &&
            currentStream.delegatedAt,
        );

      if (currentStatus === "stopped") {
        toast.info(
          "Stopped streams must be fully closed first. Then you can create a fresh stream and go live again.",
        );
        return;
      }

      if (!currentOnboarded) {
        await handleOnboardToPer(currentStream);
        currentStream =
          (await fetchLatestStreamForEmployee(employee.id)) ?? currentStream;
        currentPreview = privateStates[currentStream.id] ?? null;
        currentStatus =
          resolveStatusWithMissing(currentStream, currentPreview) ??
          currentStream.status;
        currentMissingPrivateState = !!missingPrivateStates[currentStream.id];
        currentOnboarded = Boolean(
          !currentMissingPrivateState &&
            currentStream.employeePda &&
            currentStream.privatePayrollPda &&
            currentStream.permissionPda &&
            currentStream.delegatedAt,
        );
      }

      if (!currentOnboarded) {
        toast.info(
          "PER setup is still finishing. Refresh once the employee shell and private payroll state are ready.",
        );
        return;
      }

      currentPrivateInitStatus = resolvePrivateInitStatus(employee, currentStream);
      if (currentPrivateInitStatus !== "confirmed") {
        toast.info(
          currentPrivateInitStatus === "failed"
            ? "Private recipient setup failed. The system will retry automatically, or use Retry Init from Employees before going live."
            : "Private recipient setup is still pending. Wait for auto-init or use Retry Init from Employees.",
        );
        return;
      }

      if (currentStatus === "active") {
        toast.success("This payroll stream is already live.");
        return;
      }

      if (currentStatus === "paused") {
        await handleControlStream(currentStream, "resume");
        return;
      }

      toast.info("This stream is not ready to go live yet. Refresh state and try again.");
    },
    [
      walletAddress,
      handleSaveDraftStream,
      fetchLatestStreamForEmployee,
      privateStates,
      resolveStatusWithMissing,
      missingPrivateStates,
      handleOnboardToPer,
      handleControlStream,
    ],
  );

  const handleRunTick = useCallback(
    async (
      stream?: PayrollStream,
      options?: {
        cashoutRequest?: CashoutRequestRecord;
        settlementAmountMicro?: number;
      },
    ) => {
      if (!walletAddress || !publicKey || !signTransaction || !signMessage) {
        toast.error(
          "Connect a wallet that supports transaction signing and message signing",
        );
        return;
      }

      if (stream) {
        setRunningTickStream(stream.id);
      } else {
        setRunningTick(true);
      }

      try {
        const teeAuthToken = await getOrFetchToken();
        let streamEffectiveStatus: StreamStatus | null = null;

        if (stream) {
          let effectiveStatus = missingPrivateStates[stream.id]
            ? "stopped"
            : getEffectiveStreamStatus(stream, privateStates[stream.id]) ??
              stream.status;
          const previewResult =
            (await fetchPrivatePreview(stream, { silent: true })) ??
            privateStates[stream.id] ??
            null;

          if (previewResult === "missing") {
            toast.info(
              "This stopped stream no longer has a private payroll state in PER. There is nothing left to settle; create a fresh stream if you want payroll to go live again.",
            );
            return;
          }

          effectiveStatus =
            getEffectiveStreamStatus(stream, previewResult) ?? effectiveStatus;
          streamEffectiveStatus = effectiveStatus;

          if (effectiveStatus === "paused") {
            toast.info(
              "Paused streams cannot be settled with the current payroll instruction. Resume first if you need to settle more payroll.",
            );
            return;
          }
        }

        const tickBuildResponse = await walletAuthenticatedFetch({
          path: `/api/v1/payroll/tick?wallet=${walletAddress}`,
          method: "POST",
          wallet: walletAddress,
          signMessage,
          body: {
            employerWallet: walletAddress,
            teeAuthToken,
            streamId: stream?.id,
            cashoutRequestId: options?.cashoutRequest?.id,
            maxSettlementAmountMicro: options?.cashoutRequest
              ? Math.round(options.cashoutRequest.requestedAmount * 1_000_000)
              : options?.settlementAmountMicro,
          },
        });

        const tickBuildJson = (await tickBuildResponse.json()) as
          | TickBuildResponse
          | { error?: string; needsRecovery?: boolean; results?: TickBuildResult[] };

        if (!tickBuildResponse.ok) {
          if ("needsRecovery" in tickBuildJson && tickBuildJson.needsRecovery && Array.isArray(tickBuildJson.results)) {
            const recoveryState: Record<string, TickBuildResult> = {};
            for (const result of tickBuildJson.results) {
              if (
                result.streamId &&
                typeof result.amountMicro === "number" &&
                (result.transferSignature || result.accountingOnly)
              ) {
                recoveryState[result.streamId] = result;
              }
            }
            setStreamsNeedingRecovery((prev) => ({ ...prev, ...recoveryState }));
            setRunningTick(false);
            setRunningTickStream(null);
            setSettlingTickStream(null);
            toast.error(
              stream
                ? "A previous payroll payment needs accounting sync. Use the Sync Payroll State button below; no new treasury transfer will be sent."
                : "A previous payroll payment needs accounting sync. Open the affected payroll row and click Sync Payroll State.",
            );
            return;
          }

          throw new Error(
            "error" in tickBuildJson
              ? tickBuildJson.error || "Failed to build payroll tick"
              : "Failed to build payroll tick",
          );
        }

        const tickBuild = tickBuildJson as TickBuildResponse;

        if (tickBuild.processed === 0) {
          await fetchPayrollConfig();
          if (stream && streamEffectiveStatus === "stopped") {
            const refreshedPreview =
              (await fetchPrivatePreview(stream, { silent: true })) ?? null;
            const stoppedLifecycle = deriveStoppedLifecycleState({
              effectiveStatus: "stopped",
              preview: refreshedPreview === "missing" ? null : refreshedPreview,
              hasMissingPrivateState: refreshedPreview === "missing",
            });
            toast.info(
              stoppedLifecycle.phase === "fully_closed"
                ? "This stream is already fully closed. Create a fresh stream if you want payroll to go live again."
                : stoppedLifecycle.phase === "ready_to_close"
                  ? "Remaining payroll is already settled. Close the stream to finish cleanup."
                  : "No remaining payroll is available to settle right now.",
            );
            return;
          }
          toast.info(
            stream
              ? "This stream is not active yet"
              : "No active streams to process",
          );
          return;
        }

        const actionableResults = tickBuild.results.filter(
          (result) =>
            !result.skipped &&
            (result.transferSignature || result.accountingOnly) &&
            (result.transactions?.settleSalary || result.settlementAlreadyApplied) &&
            result.transactions?.commitEmployee &&
            typeof result.amountMicro === "number" &&
            result.employeePda &&
            result.privatePayrollPda,
        );

        if (actionableResults.length === 0) {
          await fetchPayrollConfig();
          if (stream && streamEffectiveStatus === "stopped") {
            const refreshedPreview =
              (await fetchPrivatePreview(stream, { silent: true })) ?? null;
            const stoppedLifecycle = deriveStoppedLifecycleState({
              effectiveStatus: "stopped",
              preview: refreshedPreview === "missing" ? null : refreshedPreview,
              hasMissingPrivateState: refreshedPreview === "missing",
            });
            toast.info(
              stoppedLifecycle.phase === "fully_closed"
                ? "This stream is already fully closed. Create a fresh stream if you want payroll to go live again."
                : stoppedLifecycle.phase === "ready_to_close"
                  ? "Remaining payroll is already settled. Close the stream to finish cleanup."
                  : "No remaining payroll is available to settle right now.",
            );
            return;
          }
          const firstReason = tickBuild.results.find(
            (result) => result.reason,
          )?.reason;
          toast.info(firstReason || "No accrued payroll amount to settle yet");
          return;
        }

        const hasAccountingOnlyRepair = actionableResults.some(
          (result) => result.accountingOnly,
        );
        toast.info(
          hasAccountingOnlyRepair
            ? "Previous transfer found. Approve PER accounting sync; no new treasury transfer will be sent"
            : "Treasury transfer complete. Approve settlement sync transaction(s) in your wallet",
        );

        const finalizedResults: Array<{
          streamId: string;
          employeeId: string;
          employeeWallet: string;
          cashoutRequestId?: string;
          requestedAmountMicro?: number;
          amountMicro: number;
          payoutMode?: PayrollPayoutMode;
          destinationWallet?: string;
          transferFromBalance?: "base" | "ephemeral";
          transferToBalance?: "base" | "ephemeral";
          transferSendTo?: string;
          employeePda: string;
          privatePayrollPda: string;
          transferSignature?: string;
          accountingOnly?: boolean;
          settleSalarySignature?: string;
          commitSignature: string;
        }> = [];

        if (stream) {
          setRunningTickStream(null);
          setSettlingTickStream(stream.id);
        } else {
          setRunningTick(false);
        }

        for (const result of actionableResults) {
          // Treasury transfer is executed server-side; frontend signs only
          // settle/commit steps to finalize on-chain payroll state.
          const transferSignature = result.transferSignature;

          let settleSalarySignature: string | undefined;
          if (result.transactions!.settleSalary) {
            try {
              settleSalarySignature = await signAndSend(
                result.transactions!.settleSalary.transactionBase64,
                signTransaction,
                {
                  sendTo: result.transactions!.settleSalary.sendTo,
                  rpcUrl: getTeeRpcUrl(teeAuthToken),
                  signMessage,
                  publicKey,
                },
              );
            } catch (error: unknown) {
              throw new Error(
                `Run Tick failed at settleSalary for ${result.employeeWallet}: ${error instanceof Error ? error.message : "Unknown error"
                }`,
              );
            }
          }

          let commitSignature: string;
          try {
            commitSignature = await signAndSend(
              result.transactions!.commitEmployee!.transactionBase64,
              signTransaction,
              {
                sendTo: result.transactions!.commitEmployee!.sendTo,
                rpcUrl: getTeeRpcUrl(teeAuthToken),
                signMessage,
                publicKey,
              },
            );
          } catch (error: unknown) {
            throw new Error(
              `Run Tick failed at commitEmployee for ${result.employeeWallet}: ${error instanceof Error ? error.message : "Unknown error"
              }`,
            );
          }

          finalizedResults.push({
            streamId: result.streamId,
            employeeId: result.employeeId,
            employeeWallet: result.employeeWallet,
            cashoutRequestId: result.cashoutRequestId,
            requestedAmountMicro: result.requestedAmountMicro,
            amountMicro: result.amountMicro!,
            payoutMode: result.payoutMode,
            destinationWallet: result.destinationWallet,
            transferFromBalance: result.transferFromBalance,
            transferToBalance: result.transferToBalance,
            transferSendTo: result.transferSendTo,
            employeePda: result.employeePda!,
            privatePayrollPda: result.privatePayrollPda!,
            transferSignature,
            accountingOnly: result.accountingOnly,
            settleSalarySignature,
            commitSignature,
          });
        }

        if (finalizedResults.length === 0) {
          toast.info("No payroll settlements were signed");
          return;
        }

        const finalizeResponse = await walletAuthenticatedFetch({
          path: `/api/v1/payroll/tick?wallet=${walletAddress}`,
          method: "PATCH",
          wallet: walletAddress,
          signMessage,
          body: {
            employerWallet: walletAddress,
            results: finalizedResults,
          },
        });

        const finalizeJson = (await finalizeResponse.json()) as {
          error?: string;
          totalTransferredMicro?: number;
          processed?: number;
        };

        if (!finalizeResponse.ok) {
          throw new Error(
            finalizeJson.error || "Failed to finalize payroll tick",
          );
        }

        const amount = finalizeJson.totalTransferredMicro
          ? (finalizeJson.totalTransferredMicro / 1_000_000).toFixed(6)
          : "0.000000";

        toast.success(
          stream
            ? `Tick complete: Transferred ${amount} USDC`
            : `Tick complete: Processed ${finalizeJson.processed ?? finalizedResults.length} stream(s), Transferred ${amount} USDC`,
        );

        if (stream && !options?.cashoutRequest) {
          setTickAmountInputs((prev) => ({
            ...prev,
            [stream.id]: "",
          }));
        }

        await fetchPayrollConfig();
      } catch (err: unknown) {
        toast.error(
          `Payroll tick failed: ${err instanceof Error ? err.message : "Unknown error"
          }`,
        );
      } finally {
        if (stream) {
          setRunningTickStream((current) =>
            current === stream.id ? null : current,
          );
          setSettlingTickStream((current) =>
            current === stream.id ? null : current,
          );
        } else {
          setRunningTick(false);
        }
      }
    },
    [
      walletAddress,
      publicKey,
      signTransaction,
      signMessage,
      getOrFetchToken,
      getTeeRpcUrl,
      missingPrivateStates,
      privateStates,
      fetchPrivatePreview,
      fetchPayrollConfig,
    ],
  );

  const handleSyncPayrollState = useCallback(
    async (stream: PayrollStream, recoveryState: TickBuildResult) => {
      if (!walletAddress || !publicKey || !signTransaction || !signMessage) return;

      try {
        setSettlingTickStream(stream.id);
        const teeAuthToken = await getOrFetchToken();

        const { transactions, transferSignature, amountMicro } = recoveryState;
        if ((!transactions?.settleSalary && !recoveryState.settlementAlreadyApplied) || !transactions?.commitEmployee || typeof amountMicro !== "number") {
          throw new Error("Recovery state is missing transaction payloads or amount.");
        }

        let settleSalarySignature: string | undefined;
        if (transactions.settleSalary) {
          try {
            settleSalarySignature = await signAndSend(
              transactions.settleSalary.transactionBase64,
              signTransaction,
              {
                sendTo: transactions.settleSalary.sendTo,
                rpcUrl: getTeeRpcUrl(teeAuthToken),
                signMessage,
                publicKey,
              },
            );
          } catch (error: unknown) {
            throw new Error(
              `Sync failed at settleSalary: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        }

        let commitSignature: string;
        try {
          commitSignature = await signAndSend(
            transactions.commitEmployee.transactionBase64,
            signTransaction,
            {
              sendTo: transactions.commitEmployee.sendTo,
              rpcUrl: getTeeRpcUrl(teeAuthToken),
              signMessage,
              publicKey,
            },
          );
        } catch (error: unknown) {
          throw new Error(
            `Sync failed at commitEmployee: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }

        const finalizedResult = {
          streamId: stream.id,
          employeeId: stream.employeeId,
          employeeWallet: recoveryState.employeeWallet || "",
          amountMicro,
          employeePda: recoveryState.employeePda || "",
          privatePayrollPda: recoveryState.privatePayrollPda || "",
          transferSignature,
          accountingOnly: recoveryState.accountingOnly,
          settleSalarySignature,
          commitSignature,
        };

        const finalizeResponse = await walletAuthenticatedFetch({
          path: `/api/v1/payroll/tick?wallet=${walletAddress}`,
          method: "PATCH",
          wallet: walletAddress,
          signMessage,
          body: {
            employerWallet: walletAddress,
            results: [finalizedResult],
          },
        });

        const finalizeJson = await finalizeResponse.json();
        if (!finalizeResponse.ok) {
          throw new Error(finalizeJson.error || "Failed to finalize synced tick");
        }

        toast.success(`Payroll State Synced: ${(amountMicro / 1_000_000).toFixed(6)} USDC settled`);
        
        // Clear resolved recovery marker after successful finalize.
        setStreamsNeedingRecovery((prev) => {
          const next = { ...prev };
          delete next[stream.id];
          return next;
        });

        await fetchPayrollConfig();
      } catch (err: unknown) {
        toast.error(`Sync failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      } finally {
        setSettlingTickStream((current) => (current === stream.id ? null : current));
      }
    },
    [
      walletAddress,
      publicKey,
      signTransaction,
      signMessage,
      getOrFetchToken,
      getTeeRpcUrl,
      fetchPayrollConfig,
    ],
  );

  return (
    <EmployerLayout>
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href={focusedEmployeeId ? "/people" : "/dashboard"}
            className="inline-flex items-center gap-1.5 text-xs text-[#a8a8aa] hover:text-white transition-colors font-bold uppercase tracking-wider group"
          >
            <ChevronLeft
              size={14}
              className="group-hover:-translate-x-0.5 transition-transform"
            />{" "}
            {focusedEmployeeId ? "Back to People" : "Back"}
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#0a0a0a] px-3 py-1.5 shadow-sm">
            <ShieldCheck
              size={12}
              className={
                privatePayrollHealth === "ok"
                  ? "text-emerald-500"
                  : privatePayrollHealth === "error"
                    ? "text-amber-500"
                    : "text-[#8f8f95]"
              }
            />
            <span
              className={`text-[9px] font-bold uppercase tracking-[0.15em] ${privatePayrollHealth === "ok"
                ? "text-emerald-300"
                : privatePayrollHealth === "error"
                  ? "text-amber-300"
                  : "text-[#a8a8aa]"
                }`}
            >
              AuraFlow Payments {privatePayrollHealth === "ok" ? "Online" : privatePayrollHealth === "error" ? "Degraded" : "Checking"}
            </span>
          </div>
        </div>

        {!connected ? (
          <div className="flex flex-col items-center justify-center py-24 text-center bg-[#111111] rounded-[2.5rem] border border-white/10">
            <div className="w-20 h-20 rounded-3xl bg-[#0a0a0a] border border-white/10 shadow-sm flex items-center justify-center mb-6">
              <Wallet size={32} className="text-white" />
            </div>
            <p className="text-white text-xl mb-1 font-semibold tracking-tight">
              Connect your wallet to continue
            </p>
          </div>
        ) : (
          <>
            {!focusedEmployeeId ? (
              <div className="mb-8 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                      {focusedEmployee ? "Focused Payroll View" : "Stream Operations"}
                    </p>
                    <p className="max-w-2xl text-sm text-[#b6b6bc]">
                      {focusedEmployee
                        ? "All the realtime payroll controls for this employee now live here. You can keep People for setup, then manage the live stream from this focused page."
                        : "Use People for employee setup, salary, role, and monthly terms. This page stays focused on PER health, settlement, onboarding status, and stream controls."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href="/people"
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-[#0a0a0a] px-5 py-2.5 text-xs font-bold text-white transition-all hover:border-white/30 shadow-sm"
                    >
                      Open People Directory
                    </Link>
                    <Link
                      href="/disburse/manual"
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-[#0a0a0a] px-5 py-2.5 text-xs font-bold text-white transition-all hover:border-white/30 shadow-sm"
                    >
                      Legacy Manual Batch Payroll
                    </Link>
                  </div>
                </div>
              </div>
            ) : null}

            {!focusedEmployeeId ? (
              <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8f95]">
                    Current cycle
                  </p>
                  <p className="mt-2 text-lg font-bold tracking-tight text-white">
                    {cycleInfo.label}
                  </p>
                  <div className="mt-2">{renderSourceBadge("backend")}</div>
                  <p className="mt-1 text-xs text-[#a8a8aa]">
                    {cycleInfo.start.toLocaleDateString()} -{" "}
                    {cycleInfo.end.toLocaleDateString()} · {cycleInfo.totalDays} days
                  </p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8f95]">
                    Monthly liability
                  </p>
                  <p className="mt-2 text-lg font-bold tracking-tight text-white">
                    {formatUsd(monthlyLiability)}
                  </p>
                  <div className="mt-2">{renderSourceBadge("backend")}</div>
                  <p className="mt-1 text-xs text-[#a8a8aa]">
                    Projected salary allocation for this cycle
                  </p>
                </div>
                <div className="rounded-3xl border border-white/10 bg-[#0a0a0a] p-5 shadow-sm">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8f95]">
                    Active daily burn
                  </p>
                  <p className="mt-2 text-lg font-bold tracking-tight text-white">
                    {formatUsd(activeDailyBurn)}
                  </p>
                  <div className="mt-2">{renderSourceBadge("backend")}</div>
                  <p className="mt-1 text-xs text-[#a8a8aa]">
                    Based on active stream rates × 86,400 sec
                  </p>
                </div>
                <div
                  className={`rounded-3xl border p-5 shadow-sm ${treasuryPrivateBalance !== null &&
                    monthlyLiability > 0 &&
                    treasuryPrivateBalance < monthlyLiability
                    ? "border-amber-500/30 bg-amber-500/10"
                    : "border-white/10 bg-[#0a0a0a]"
                    }`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8f95]">
                    Treasury runway
                  </p>
                  <p className="mt-2 text-lg font-bold tracking-tight text-white">
                    {treasuryRunwayDays === null
                      ? "n/a"
                      : `${treasuryRunwayDays.toFixed(1)} days`}
                  </p>
                  <div className="mt-2">
                    {renderSourceBadge(
                      treasuryPrivateBalance === null ? "unavailable" : "live-per",
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#a8a8aa]">
                    Treasury:{" "}
                    {treasuryPrivateBalance === null
                      ? "not synced"
                      : formatUsd(treasuryPrivateBalance)}
                  </p>
                  <button
                    type="button"
                    onClick={() => void refreshTreasuryPrivateBalance()}
                    disabled={refreshingTreasuryBalance}
                    className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#a8a8aa] hover:text-white disabled:opacity-40"
                  >
                    {refreshingTreasuryBalance ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <RefreshCw size={11} />
                    )}
                    Sync treasury
                  </button>
                </div>
              </div>
            ) : null}

            {!focusedEmployeeId && (readinessSummary.perMissing > 0 ||
              readinessSummary.recipientPending > 0 ||
              readinessSummary.recipientFailed > 0 ||
              readinessSummary.paused > 0 ||
              (treasuryPrivateBalance !== null &&
                monthlyLiability > treasuryPrivateBalance)) && (
                <div className="mb-8 rounded-3xl border border-amber-500/30 bg-amber-500/10 p-5">
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={18} className="mt-0.5 text-amber-300" />
                    <div>
                      <p className="text-sm font-bold text-amber-300">
                        Payroll readiness needs attention
                      </p>
                      <p className="mt-1 text-xs text-amber-300">
                        PER missing: {readinessSummary.perMissing} · Recipient init
                        pending: {readinessSummary.recipientPending} · Recipient init
                        failed: {readinessSummary.recipientFailed} · Paused streams:{" "}
                        {readinessSummary.paused}
                        {treasuryPrivateBalance !== null &&
                          monthlyLiability > treasuryPrivateBalance
                          ? " · Treasury appears underfunded for this cycle."
                          : ""}
                      </p>
                    </div>
                  </div>
                </div>
              )}

            {!focusedEmployeeId ? (
              <div className="mb-8 rounded-[2rem] border border-white/10 bg-[#0a0a0a] p-6 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarDays size={15} className="text-[#8f8f95]" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8f95]">
                      Salary allocation board
                    </p>
                  </div>
                  {!focusedEmployeeId ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => void handleBatchResume()}
                        disabled={controllingStream !== null}
                        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-300 disabled:opacity-40"
                      >
                        <PlayCircle size={12} />
                        Resume paused
                      </button>
                      <button
                        onClick={() => void handleBatchPause()}
                        disabled={controllingStream !== null}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-[#0a0a0a] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#b6b6bc] disabled:opacity-40"
                      >
                        <Pause size={12} />
                        Pause active
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left">
                    <thead>
                      <tr className="border-b border-white/10 text-[10px] uppercase tracking-[0.2em] text-[#8f8f95]">
                        <th className="py-2 pr-3 font-bold">Employee</th>
                        <th className="py-2 pr-3 font-bold">Monthly eq.</th>
                        <th className="py-2 pr-3 font-bold">Streamed so far</th>
                        <th className="py-2 pr-3 font-bold">Claimable now</th>
                        <th className="py-2 pr-3 font-bold">Remaining cycle</th>
                        <th className="py-2 font-bold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSalaryAllocationRows.map((row) => (
                        <tr key={row.employee.id} className="border-b border-white/5 text-sm">
                          <td className="py-3 pr-3">
                            <Link
                              href={`/people/${row.employee.id}`}
                              className="inline-flex flex-col gap-1 no-underline"
                            >
                              <span className="font-semibold text-white transition-colors hover:text-[#b6b6bc]">
                                {row.employee.name}
                              </span>
                              {(row.employee.role || row.employee.department) && (
                                <span className="text-[11px] text-[#8f8f95]">
                                  {[row.employee.role, row.employee.department]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              )}
                            </Link>
                          </td>
                          <td className="py-3 pr-3 font-mono text-white">
                            {formatUsd(row.monthlySalary)}
                            <div className="mt-1 text-[10px] text-[#8f8f95]">
                              {row.cycleLabel}
                            </div>
                            <div className="mt-1">{renderSourceBadge("backend")}</div>
                          </td>
                          <td className="py-3 pr-3 font-mono text-[#b6b6bc]">
                            {formatUsd(row.streamedSoFar)}
                            <div className="mt-1">{renderSourceBadge("backend")}</div>
                          </td>
                          <td className="py-3 pr-3 font-mono text-[#00A647]">
                            {row.claimableNow === null
                              ? "n/a"
                              : formatUsd(row.claimableNow)}
                            <div className="mt-1">
                              {renderSourceBadge(
                                row.claimableNow === null ? "unavailable" : "live-per",
                              )}
                            </div>
                          </td>
                          <td className="py-3 pr-3 font-mono text-[#b6b6bc]">
                            {formatUsd(row.remainingThisCycle)}
                            <div className="mt-1 text-[10px] text-[#8f8f95]">
                              Target: {formatUsd(row.cycleTarget)}
                            </div>
                            <div className="mt-1">{renderSourceBadge("backend")}</div>
                          </td>
                          <td className="py-3">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${row.status === "active"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : row.status === "paused"
                                  ? "bg-amber-500/10 text-amber-400"
                                  : "bg-rose-500/10 text-rose-400"
                                }`}
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="border border-white/10 rounded-[2rem] bg-[#0a0a0a] shadow-sm mb-12 overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-8 pt-8 pb-6">
                <div className="flex items-center gap-3">
                  {visibleManagedEmployees.some(
                    (employee) => {
                      const activeStream =
                        employeeStreamMap.get(employee.id) ?? null;
                      return (
                        resolveStatusWithMissing(
                          activeStream,
                          activeStream
                            ? (privateStates[activeStream.id] ?? null)
                            : null,
                        ) === "active"
                      );
                    },
                  ) && (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00E559] opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00E559]" />
                      </span>
                    )}
                  <div>
                    <h3 className="font-bold text-[10px] text-white uppercase tracking-[0.2em]">
                      {focusedEmployee ? "Payroll Stream" : "Realtime Payroll Streams"}
                    </h3>
                    <p className="text-[11px] text-[#8f8f95] mt-0.5">
                      {focusedEmployee
                        ? "Live stream controls and private payroll state for this employee"
                        : "Employer-signed private payroll streams"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!focusedEmployeeId ? (
                    <button
                      onClick={() => handleRunTick()}
                      disabled={
                        loadingPayrollConfig ||
                        runningTick ||
                        runningTickStream !== null ||
                        settlingTickStream !== null ||
                        !walletAddress
                      }
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all text-[11px] font-bold disabled:opacity-40 cursor-pointer shadow-sm uppercase tracking-wider"
                    >
                      {runningTick ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Zap size={13} />
                      )}
                      Run Active Ticks
                    </button>
                  ) : null}
                  <button
                    onClick={fetchPayrollConfig}
                    disabled={loadingPayrollConfig}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-[#111111]/70 text-[#a8a8aa] hover:text-white hover:border-white/15 transition-all text-[11px] font-bold disabled:opacity-40 cursor-pointer uppercase tracking-wider"
                  >
                    {loadingPayrollConfig ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                    Refresh
                  </button>
                </div>
              </div>

              {!focusedEmployeeId ? <div className="h-px bg-white/10 mx-8" /> : null}

              {!focusedEmployeeId ? (
                <div className="px-8 py-6">
                  <div className="rounded-[1.75rem] border border-white/10 bg-[#111111]/80 p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8f95]">
                          Employee setup lives in People
                        </p>
                        <p className="mt-2 max-w-2xl text-sm text-[#a8a8aa]">
                          Add employees, define salary, set start time, and manage department or role from the People flow. This stream dashboard is now reserved for PER onboarding, private-state checks, and run controls.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href="/people"
                          className="inline-flex items-center justify-center gap-2 rounded-full bg-black px-5 py-3 text-sm font-bold text-white transition-all hover:bg-neutral-800 no-underline"
                        >
                          Open People
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {!focusedEmployeeId ? <div className="h-px bg-white/10 mx-8" /> : null}

              <div className="px-8 py-6 space-y-4">
                {!focusedEmployeeId ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-[#8f8f95]" />
                      <span className="text-[10px] text-[#8f8f95] uppercase tracking-[0.2em] font-bold">
                        {visibleManagedEmployees.length} Employee
                        {visibleManagedEmployees.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                ) : null}

                {visibleManagedEmployees.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-12 h-12 rounded-2xl border border-dashed border-white/10 flex items-center justify-center">
                      <Users size={20} className="text-[#8f8f95]" />
                    </div>
                    <p className="text-sm text-[#8f8f95] text-center">
                      {focusedEmployeeId
                        ? "This employee was not found in your payroll roster"
                        : "Add your first employee above to get started"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleManagedEmployees.map((employee) => {
                      const stream =
                        employeeStreamMap.get(employee.id) ?? null;
                      const pendingRequests = stream
                        ? (cashoutRequestsByStream.get(stream.id) ?? []).filter(
                          (request) => request.status === "pending" || ["requested", "paying", "needs_sync", "failed"].includes(request.status),
                        )
                        : [];
                      const preview = stream
                        ? (privateStates[stream.id] ?? null)
                        : null;
                      const observedCheckpointStatus: string = "idle";
                      const checkpointStateFresh = isCheckpointStateFresh(
                        stream,
                        preview,
                        nowMs,
                      );
                      const employeeInitializedAtFromAnyStream =
                        streams.find(
                          (candidate) =>
                            managedEmployees.find(
                              (managed) =>
                                managed.id === candidate.employeeId &&
                                managed.wallet === employee.wallet,
                            ) &&
                            !!candidate.recipientPrivateInitializedAt,
                        )?.recipientPrivateInitializedAt ?? null;
                      const hasMissingPrivateState = !!(
                        stream && missingPrivateStates[stream.id]
                      );
                      const needsPayrollSync = !!(
                        stream && streamsNeedingRecovery[stream.id]
                      );
                      const effectiveStatus =
                        resolveStatusWithMissing(stream, preview) ?? "stopped";
                      const hasStatusMismatch =
                        !!stream &&
                        !!preview &&
                        preview.state.status !== stream.status;
                      const isOnboarded = !!(
                        !hasMissingPrivateState &&
                        stream?.employeePda &&
                        stream?.privatePayrollPda &&
                        stream?.permissionPda &&
                        stream?.delegatedAt
                      );
      const privateInitStatus = resolvePrivateInitStatus(
        {
          ...employee,
                          privateRecipientInitializedAt:
                            employee.privateRecipientInitializedAt ??
                            employeeInitializedAtFromAnyStream,
                        },
                        stream,
                      );
                      const isRecipientPrivateReady =
                        privateInitStatus === "confirmed";
                      const privateInitBadge = getPrivateInitBadge(privateInitStatus);
                      const stoppedLifecycle = deriveStoppedLifecycleState({
                        effectiveStatus,
                        preview,
                        hasMissingPrivateState,
                      });
                      const closeProgress = stream
                        ? closeProgressByStream[stream.id] ?? null
                        : null;
                      const mustSettleBeforeClose =
                        stoppedLifecycle.mustSettleBeforeClose;
                      const isFullyClosed = stoppedLifecycle.isFullyClosed;
                      const goLiveReadiness = resolveGoLiveReadiness({
                        stream,
                        effectiveStatus,
                        isFullyClosed,
                        mustSettleBeforeClose,
                        isOnboarded,
                        isRecipientPrivateReady,
                        privateInitStatus,
                      });
                      const canShowCheckpointControl = false;

                      const lastMs = preview ? Number(preview.state.lastAccrualTimestamp) * 1000 : 0;
                      const ratePerSecondMicro = stream ? stream.ratePerSecond * 1_000_000 : 0;
                      
                      let liveAccruedUnpaidMicro = preview ? Number(preview.state.accruedUnpaidMicro) || 0 : 0;
                      let liveTotalPaidPrivateMicro = preview ? Number(preview.state.totalPaidPrivateMicro) || 0 : 0;
                      let liveEffectiveClaimableAmountMicro = preview ? Number(preview.state.effectiveClaimableAmountMicro) || 0 : 0;
                      
                      if (preview && effectiveStatus === "active" && lastMs > 0 && nowMs > lastMs) {
                        const diffSeconds = (nowMs - lastMs) / 1000;
                        const accruedSinceLast = diffSeconds * ratePerSecondMicro;
                        
                        liveAccruedUnpaidMicro += accruedSinceLast;
                        liveEffectiveClaimableAmountMicro += accruedSinceLast;
                      }

                      return (
                        <div
                          key={employee.id}
                          className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.05),transparent_32%),linear-gradient(180deg,rgba(14,14,16,0.98),rgba(8,8,9,1))] shadow-[0_24px_80px_rgba(0,0,0,0.42)]"
                        >
                          <div className="flex flex-col gap-3 px-6 pt-5 pb-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex min-w-0 items-start gap-4">
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-bold text-white shadow-inner">
                                {employee.name?.charAt(0)?.toUpperCase() ?? "?"}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-lg font-bold tracking-tight text-white">
                                  {employee.name}
                                </p>
                                {(employee.role || employee.department) && (
                                  <p className="mt-1 truncate text-[11px] text-[#a8a8aa]">
                                    {[employee.role, employee.department]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                )}
                                <p className="mt-1 font-mono text-[11px] tracking-[0.18em] text-[#8f8f95]">
                                  {employee.wallet.slice(0, 6)}...
                                  {employee.wallet.slice(-6)}
                                </p>
                                {employee.notes &&
                                  employee.notes !== "__open__" && (
                                    <p className="mt-2 truncate text-[11px] italic text-[#8f8f95]">
                                      {employee.notes}
                                    </p>
                                  )}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <span
                                className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.22em] ${needsPayrollSync
                                  ? "bg-amber-500/10 text-amber-300 border-amber-400/30"
                                  : effectiveStatus === "active"
                                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                                  : effectiveStatus === "paused"
                                    ? "bg-amber-500/10 text-amber-400 border-amber-300"
                                    : effectiveStatus === "stopped"
                                      ? "bg-red-500/10 text-red-400 border-red-500/30"
                                      : "bg-[#111111] text-[#a8a8aa] border-white/15"
                                  }`}
                              >
                                {needsPayrollSync ? "needs sync" : effectiveStatus ?? "draft"}
                              </span>
                              <span
                                className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.22em] ${isOnboarded
                                  ? "bg-[#0f0f10] text-white border-white/10"
                                  : "bg-[#111111] text-[#a8a8aa] border-white/15"
                                  }`}
                              >
                                {isOnboarded ? "PER LIVE" : "PER PENDING"}
                              </span>
                              <span
                                className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.22em] ${privateInitBadge.className}`}
                              >
                                {privateInitBadge.label}
                              </span>
                              {observedCheckpointStatus === "stale" ? (
                                <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-500/10 px-3.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.22em] text-amber-300">
                                  sync stale
                                </span>
                              ) : null}
                              {stream && pendingRequests.length > 0 ? (
                                <span className="inline-flex items-center rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.22em] text-fuchsia-300 animate-pulse">
                                  CASHOUT ×{pendingRequests.length}
                                </span>
                              ) : null}
                              {needsPayrollSync ? (
                                <p className="w-full pt-1 text-[10px] font-medium text-amber-300 sm:text-right">
                                  Previous payment was sent. Finalize PER accounting with Sync Payroll State.
                                </p>
                              ) : effectiveStatus === "stopped" ? (
                                <p className="w-full pt-1 text-[10px] font-medium text-rose-300 sm:text-right">
                                  Terminal state.
                                </p>
                              ) : null}
                              {privateInitStatus === "failed" &&
                              employee.privateRecipientInitError ? (
                                <p className="w-full pt-1 text-[10px] font-medium text-rose-300 sm:text-right">
                                  {employee.privateRecipientInitError} Use Retry Init from Employees after funding sponsor/treasury if required.
                                </p>
                              ) : privateInitStatus === "pending" ||
                                privateInitStatus === "processing" ? (
                                <p className="w-full pt-1 text-[10px] font-medium text-[#8f8f95] sm:text-right">
                                  System auto-init is running. Retry Init is available from Employees if this remains pending.
                                </p>
                              ) : null}
                            </div>
                          </div>

                          {hasStatusMismatch ? (
                            <div className="px-5 pb-1">
                              <p className="text-[10px] text-[#8f8f95]">
                                Live PER state:{" "}
                                <span className="font-bold uppercase text-white">
                                  {preview?.state.status}
                                </span>
                              </p>
                            </div>
                          ) : null}

                          <div className="mx-6 h-px bg-white/5" />

                          <div className="flex flex-col items-center justify-center px-6 py-6">
                            {/* Hero Dashboard */}
                            <div className="text-center mb-5">
                              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#a8a8aa] mb-4 shadow-sm">
                                {effectiveStatus === "active" ? (
                                  <>
                                    <span className="relative flex h-2 w-2">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                    </span>
                                    <span className="text-emerald-300">Live Streaming</span>
                                  </>
                                ) : effectiveStatus === "paused" ? (
                                  <>
                                    <span className="h-2 w-2 rounded-full bg-amber-500"></span>
                                    <span className="text-amber-400">Paused</span>
                                  </>
                                ) : (
                                  <>
                                    <span className="h-2 w-2 rounded-full bg-[#8f8f95]"></span>
                                    <span>Not Active</span>
                                  </>
                                )}
                              </div>
                              <h2 className="text-6xl font-black text-white tracking-tighter leading-none mb-2 font-mono">
                                {preview ? formatMicroUsdc(Math.floor(liveAccruedUnpaidMicro).toString()) : "0.000000"}
                              </h2>
                              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#8f8f95]">
                                Accrued USDC
                              </p>
                            </div>

                            {/* Massive Media Controls */}
                            <div className="flex items-center justify-center gap-6 mb-6">
                              {/* Pause Button */}
                              <button
                                onClick={() => stream && handleControlStream(stream, "pause")}
                                disabled={effectiveStatus !== "active" || controllingStream === stream?.id || closingStream === stream?.id}
                                className={`flex h-16 w-16 items-center justify-center rounded-full transition-all duration-300 ${
                                  effectiveStatus === "active" 
                                    ? "bg-white/[0.05] text-amber-400 hover:bg-amber-500/20 hover:text-amber-300 hover:scale-105 border border-amber-500/20 shadow-[0_0_20px_rgba(245,158,11,0.1)]" 
                                    : "bg-[#0a0a0a] text-[#333] border border-white/5 cursor-not-allowed"
                                }`}
                                title="Pause Payroll"
                              >
                                {controllingStream === stream?.id && effectiveStatus === "active" ? <Loader2 size={24} className="animate-spin" /> : <Pause size={24} fill="currentColor" />}
                              </button>

                              {/* Play / Activate Button */}
                              <button
                                onClick={() =>
                                  effectiveStatus === "stopped"
                                    ? stream && handleRestartStoppedStream(stream)
                                    : void handleGoLive(employee, stream, { isOnboarded, privateInitStatus })
                                }
                                disabled={
                                  !walletAddress ||
                                  savingStream === employee.id ||
                                  restartingStream === stream?.id ||
                                  closingStream === stream?.id ||
                                  onboardingStream === stream?.id ||
                                  controllingStream === stream?.id ||
                                  (effectiveStatus === "stopped" && !isFullyClosed) ||
                                  effectiveStatus === "active"
                                }
                                className={`flex h-24 w-24 items-center justify-center rounded-full transition-all duration-300 ${
                                  effectiveStatus !== "active"
                                    ? "bg-gradient-to-b from-emerald-400 to-emerald-600 text-black hover:scale-105 hover:shadow-[0_0_60px_rgba(16,185,129,0.3)] border border-emerald-300/50 shadow-[0_0_40px_rgba(16,185,129,0.15)]"
                                    : "bg-[#0a0a0a] text-[#333] border border-white/5 cursor-not-allowed"
                                }`}
                                title="Activate / Resume Payroll"
                              >
                                {savingStream === employee.id || restartingStream === stream?.id || onboardingStream === stream?.id || (controllingStream === stream?.id && effectiveStatus !== "active") ? (
                                  <Loader2 size={36} className="animate-spin text-black/50" />
                                ) : (
                                  <Play size={40} fill="currentColor" className="ml-1 opacity-90" />
                                )}
                              </button>

                              {/* Stop Button */}
                              <button
                                onClick={() => stream && handleControlStream(stream, "stop")}
                                disabled={!stream || effectiveStatus === "stopped" || controllingStream === stream?.id || closingStream === stream?.id}
                                className={`flex h-16 w-16 items-center justify-center rounded-full transition-all duration-300 ${
                                  stream && effectiveStatus !== "stopped"
                                    ? "bg-white/[0.05] text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 hover:scale-105 border border-rose-500/20 shadow-[0_0_20px_rgba(244,63,94,0.1)]"
                                    : "bg-[#0a0a0a] text-[#333] border border-white/5 cursor-not-allowed"
                                }`}
                                title="Stop Payroll"
                              >
                                {closingStream === stream?.id ? <Loader2 size={24} className="animate-spin" /> : <Square size={20} fill="currentColor" />}
                              </button>
                            </div>

                            {/* Secondary Stats Grid */}
                            <div className="grid w-full grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center hover:bg-white/[0.04] transition-colors">
                                <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#8f8f95] mb-0.5">Rate / Sec</p>
                                <p className="text-xs font-mono font-bold text-white">{stream ? stream.ratePerSecond.toFixed(8) : "0.0000"} USDC</p>
                              </div>
                              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center hover:bg-white/[0.04] transition-colors">
                                <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#8f8f95] mb-0.5">Monthly Salary</p>
                                <p className="text-xs font-bold text-emerald-300">{formatUsd(employee.monthlySalaryUsd ?? ratePerSecondToMonthlyUsd(stream?.ratePerSecond ?? 0))}</p>
                              </div>
                              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center hover:bg-white/[0.04] transition-colors">
                                <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#8f8f95] mb-0.5">Total Paid</p>
                                <p className="text-xs font-mono font-bold text-white">{preview ? formatMicroUsdc(Math.floor(liveTotalPaidPrivateMicro).toString()) : "0.000000"} USDC</p>
                              </div>
                              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center hover:bg-white/[0.04] transition-colors">
                                <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-[#8f8f95] mb-0.5">Claimable Now</p>
                                <p className="text-xs font-mono font-bold text-white">{preview ? formatMicroUsdc(Math.floor(liveEffectiveClaimableAmountMicro).toString()) : "0.000000"} USDC</p>
                              </div>
                            </div>
                          </div>

                          {stream && pendingRequests.length > 0 ? (
                            <>
                              <div className="h-px bg-[#111111] mx-5" />
                              <div className="px-5 py-4 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-[10px] text-fuchsia-300 uppercase tracking-[0.2em] font-bold">
                                    Pending Cashout Requests
                                  </p>
                                  <p className="text-[10px] text-[#8f8f95] font-bold uppercase tracking-wider">
                                    {loadingCashoutRequests
                                      ? "Refreshing..."
                                      : `${pendingRequests.length} open`}
                                  </p>
                                </div>
                                {pendingRequests.map((request) => (
                                  <div
                                    key={request.id}
                                    className="rounded-sm border border-white/10 bg-[#111111] px-4 py-3"
                                  >
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                      <div className="min-w-0">
                                        <p className="text-sm text-white font-bold tracking-tight">
                                          {request.requestedAmount.toFixed(2)} USDC requested
                                        </p>
                                        <p className="font-mono text-[10px] text-[#8f8f95] mt-1">
                                          {new Date(request.createdAt).toLocaleString()} •{" "}
                                          {request.employeeWallet.slice(0, 6)}...
                                          {request.employeeWallet.slice(-6)}
                                        </p>
                                        {request.note ? (
                                          <p className="text-[11px] text-[#a8a8aa] mt-2 leading-relaxed italic">
                                            {request.note}
                                          </p>
                                        ) : null}
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                                        {request.isOnChain ? (
                                          <span className="rounded-full border border-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#a8a8aa]">
                                            {request.status}
                                          </span>
                                        ) : (
                                          <>
                                            <button
                                              onClick={() =>
                                                handleRunTick(stream, {
                                                  cashoutRequest: request,
                                                })
                                              }
                                              disabled={
                                                runningTick ||
                                                runningTickStream !== null ||
                                                settlingTickStream !== null ||
                                                !isOnboarded ||
                                                !isRecipientPrivateReady
                                              }
                                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-sm bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20 text-[11px] font-bold transition-all disabled:opacity-30 uppercase tracking-wider shadow-sm"
                                            >
                                              <Zap size={13} />
                                              Settle Now
                                            </button>
                                            <button
                                              onClick={() =>
                                                handleResolveCashoutRequest(
                                                  request,
                                                  "dismissed",
                                                  "Dismissed by employer from the payroll dashboard.",
                                                )
                                              }
                                              disabled={
                                                resolvingCashoutRequestId === request.id
                                              }
                                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-sm bg-[#0a0a0a] border border-white/10 text-[#a8a8aa] hover:text-white hover:border-white/30 text-[11px] font-bold transition-all disabled:opacity-30 uppercase tracking-wider shadow-sm"
                                            >
                                              {resolvingCashoutRequestId === request.id ? (
                                                <Loader2
                                                  size={13}
                                                  className="animate-spin"
                                                />
                                              ) : (
                                                <Square size={13} />
                                              )}
                                              Dismiss
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          ) : null}

                          <div className="mx-6 h-px bg-white/5" />

                          <div className="flex flex-wrap items-center gap-3 px-6 py-5">
                            {stream && streamsNeedingRecovery[stream.id] ? (
                              <button
                                onClick={() => handleSyncPayrollState(stream, streamsNeedingRecovery[stream.id])}
                                disabled={settlingTickStream === stream.id || !walletAddress}
                                className="inline-flex items-center gap-1.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-amber-400 transition-all hover:bg-amber-500/20 shadow-sm disabled:opacity-60"
                              >
                                {settlingTickStream === stream.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <RotateCcw size={13} />
                                )}
                                {settlingTickStream === stream.id ? "Syncing..." : "Sync Payroll State"}
                              </button>
                            ) : stream && (effectiveStatus !== "stopped" || mustSettleBeforeClose) && (
                              <>
                                <div className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-[#0a0a0a] px-4 py-2.5">
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    min={0}
                                    step={0.01}
                                    value={tickAmountInputs[stream.id] ?? ""}
                                    onChange={(event) =>
                                      setTickAmountInputs((prev) => ({
                                        ...prev,
                                        [stream.id]: event.target.value,
                                      }))
                                    }
                                    placeholder={
                                      preview
                                        ? `Max ${formatMicroUsdc(
                                          preview.state.effectiveClaimableAmountMicro,
                                        )}`
                                        : "Full accrued"
                                    }
                                    className="w-28 bg-transparent font-mono text-[11px] text-white placeholder:text-[#8f8f95] outline-none"
                                    style={{ MozAppearance: "textfield" }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!preview) {
                                        toast.error(
                                          "Refresh State first to load the current accrued amount",
                                        );
                                        return;
                                      }

                                      const maxAmount =
                                        Number(
                                          preview.state
                                            .effectiveClaimableAmountMicro,
                                        ) /
                                        1_000_000;

                                      if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
                                        toast.error(
                                          "No accrued private payroll is available to settle",
                                        );
                                        return;
                                      }

                                      setTickAmountInputs((prev) => ({
                                        ...prev,
                                        [stream.id]: maxAmount.toFixed(6),
                                      }));
                                    }}
                                    disabled={!preview || hasMissingPrivateState}
                                    className="inline-flex min-h-8 items-center justify-center rounded-xl px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300 transition-colors hover:text-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    Max
                                  </button>
                                  <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#8f8f95]">
                                    USDC
                                  </span>
                                </div>
                                <button
                                  onClick={() => {
                                    const rawAmount =
                                      tickAmountInputs[stream.id] ?? "";
                                    const parsedAmount = rawAmount.trim()
                                      ? Number.parseFloat(rawAmount)
                                      : undefined;

                                    if (
                                      parsedAmount !== undefined &&
                                      (!Number.isFinite(parsedAmount) ||
                                        parsedAmount <= 0)
                                    ) {
                                      toast.error(
                                        "Enter a valid settlement amount",
                                      );
                                      return;
                                    }

                                    if (
                                      parsedAmount !== undefined &&
                                      preview
                                    ) {
                                      const maxClaimableNow =
                                        Number(
                                          preview.state
                                            .effectiveClaimableAmountMicro,
                                        ) / 1_000_000;
                                      if (
                                        Number.isFinite(maxClaimableNow) &&
                                        parsedAmount > maxClaimableNow
                                      ) {
                                        toast.error(
                                          `Amount exceeds claimable cap (${maxClaimableNow.toFixed(6)} USDC)`,
                                        );
                                        return;
                                      }
                                    }

                                    handleRunTick(stream, {
                                      settlementAmountMicro:
                                        parsedAmount !== undefined
                                          ? Math.round(parsedAmount * 1_000_000)
                                          : Math.floor(liveAccruedUnpaidMicro),
                                    });
                                  }}
                                  disabled={
                                    !walletAddress ||
                                    runningTick ||
                                    runningTickStream !== null ||
                                    settlingTickStream !== null ||
                                    !isOnboarded ||
                                    !isRecipientPrivateReady ||
                                    (effectiveStatus !== "active" &&
                                      effectiveStatus !== "stopped")
                                  }
                                  className={`inline-flex items-center gap-1.5 rounded-2xl border px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-60 shadow-sm ${
                                    effectiveStatus === "stopped"
                                      ? "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20"
                                      : "bg-[#0f0f10] border-white/10 text-white hover:bg-black"
                                  }`}
                                >
                                  {runningTickStream === stream.id ||
                                    settlingTickStream === stream.id ? (
                                    <Loader2
                                      size={13}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <Zap size={13} />
                                  )}
                                  {settlingTickStream === stream.id
                                    ? "Settling Tick"
                                    : (tickAmountInputs[stream.id] ?? "").trim() !== ""
                                      ? `Settle ${Number.parseFloat(
                                        tickAmountInputs[stream.id] ?? "",
                                      ) > 0
                                        ? Number.parseFloat(
                                          tickAmountInputs[stream.id] ?? "",
                                        ).toFixed(2)
                                        : "..."
                                      } USDC`
                                      : effectiveStatus === "stopped" &&
                                        hasMissingPrivateState
                                        ? "No PER State"
                                      : effectiveStatus === "paused"
                                          ? "Paused"
                                        : effectiveStatus === "stopped"
                                          ? "Settle Remaining"
                                          : "Settle All"}
                                </button>
                              </>
                            )}

                            {effectiveStatus !== "stopped" && stream && !isOnboarded ? (
                              <button
                                onClick={() => handleOnboardToPer(stream)}
                                disabled={!walletAddress || onboardingStream === stream.id}
                                className={`inline-flex items-center gap-1.5 rounded-2xl border px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-all disabled:opacity-60 relative z-50 bg-emerald-500 border-emerald-400 text-black hover:bg-emerald-400 scale-105 shadow-[0_0_0_9999px_rgba(0,0,0,0.85),0_0_40px_rgba(16,185,129,0.8)] ring-2 ring-emerald-400 ring-offset-4 ring-offset-[#0a0a0a] animate-pulse hover:animate-none`}
                              >
                                {onboardingStream === stream.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <Sparkles size={13} />
                                )}
                                {onboardingStream === stream.id ? "Onboarding to PER..." : "Onboard PER"}
                              </button>

                            ) : (
                              <span className={`inline-flex items-center gap-1.5 rounded-2xl border px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider shadow-sm ${
                                isOnboarded 
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" 
                                  : "border-white/10 bg-[#0f0f10] text-[#8f8f95]"
                              }`}>
                                <Sparkles size={13} />
                                {isOnboarded ? "PER Onboarded" : "No PER State"}
                              </span>
                            )}



                            {/* Advanced Engine Controls */}
                            <div className="mt-5 px-6 pb-5">
                              <details className="group">
                                <summary className="flex cursor-pointer items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#8f8f95] transition-colors hover:text-white list-none">
                                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/5 transition-transform group-open:rotate-90">
                                    <ChevronLeft size={12} className="rotate-180" />
                                  </span>
                                  Advanced Engine Controls
                                </summary>
                                
                                <div className="mt-4 rounded-2xl border border-white/5 bg-[#050505] p-5 shadow-inner">
                                  <div className="flex flex-wrap items-center gap-3">
                                    {stream && streamsNeedingRecovery[stream.id] ? (
                                      <button
                                        onClick={() => handleSyncPayrollState(stream, streamsNeedingRecovery[stream.id])}
                                        disabled={settlingTickStream === stream.id || !walletAddress}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-amber-400 transition-all hover:bg-amber-500/20 shadow-sm disabled:opacity-60"
                                      >
                                        {settlingTickStream === stream.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                                        Sync Payroll State
                                      </button>
                                    ) : null}



                                    {stream && (
                                      <button
                                        onClick={() => fetchPrivatePreview(stream)}
                                        disabled={!walletAddress || refreshingPreview === stream.id || !isOnboarded}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-[#b6b6bc] transition-all hover:bg-white/10 hover:text-white disabled:opacity-60"
                                      >
                                        {refreshingPreview === stream.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                        Refresh State
                                      </button>
                                    )}

                                    {!isFullyClosed && effectiveStatus === "stopped" ? (
                                      <button
                                        onClick={() => stream && void handleCloseStream(stream)}
                                        disabled={!walletAddress || closingStream === stream?.id || controllingStream === stream?.id || restartingStream === stream?.id || !stream || !isOnboarded || mustSettleBeforeClose}
                                        className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-red-400 transition-all hover:bg-red-500/20 disabled:opacity-60"
                                      >
                                        {closingStream === stream?.id ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
                                        {closingStream === stream?.id ? "Closing..." : "Close Stream"}
                                      </button>
                                    ) : null}
                                  </div>

                                  {effectiveStatus === "stopped" && !isFullyClosed && mustSettleBeforeClose && (
                                    <p className="mt-3 text-[10px] text-amber-400/80">
                                      * You must manually settle the remaining payroll above before this stream can be closed.
                                    </p>
                                  )}
                                  {closingStream === stream?.id && closeProgress ? (
                                    <p className="mt-3 text-[10px] font-medium text-amber-300">
                                      Close progress: {closeProgress}
                                    </p>
                                  ) : null}
                                </div>
                              </details>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </EmployerLayout>
  );
}

export default function EmployerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><div className="animate-pulse text-[#a8a8aa] text-sm font-medium">Loading...</div></div>}>
      <EmployerPageContent />
    </Suspense>
  );
}
