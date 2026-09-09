"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  RefreshCw,
  LogOut,
  ShieldCheck,
  Info,
  Send,
  AlertTriangle,
  CheckCircle2,
  X,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { EmployeeLayout } from "@/components/employee-layout";
import { useClaimData } from "@/components/claim/use-claim-data";
import { computeLiveClaimableAmountMicro } from "@/components/claim/claim-utils";
import {
  formatDisplayedUsdcBalance,
  getClaimDisabledReason,
  getClaimErrorMessage,
} from "@/components/claim/claim-helpers";
import type {
  ClaimCashoutRequest,
  OnChainPendingClaim,
} from "@/components/claim/claim-types";
import { toast } from "sonner";
import { walletAuthenticatedFetch } from "@/lib/wallet/wallet-auth-fetch";
import { isValidStellarAddress } from "@/lib/utils";
import {
  getBalance,
  getPrivateBalance,
  privateTransfer,
  signAndSend,
} from "@/lib/private-payroll-api";

export default function ClaimWithdrawPage() {
  const {
    publicKey: publicKeyRaw,
    signTransaction,
    signMessage,
    privBalance,
    payrollSummary,
    loading,
    privateAccountInitialized,
    registeredEmployeeWallet,
    initializingPrivateAccount,
    withdrawing,
    setWithdrawing,
    setInitializingPrivateAccount,
    fetchPrivateInitStatus,
    fetchPrivateBalance,
    fetchEmployeePayrollSummary,
    getOrFetchToken,
    liveNowMs,
  } = useClaimData();

  const publicKey = useMemo(() => {
    if (!publicKeyRaw) return null;
    return {
      toBase58: () => publicKeyRaw,
      toString: () => publicKeyRaw,
    };
  }, [publicKeyRaw]) as any;
  const [visiblePrivBalance, setVisiblePrivBalance] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");
  const [withdrawRecipient, setWithdrawRecipient] = useState<string>("");
  const [withdrawSyncNotice, setWithdrawSyncNotice] = useState<string>("");
  const [requestAmount, setRequestAmount] = useState<string>("");
  const [submittingRequest, setSubmittingRequest] = useState<boolean>(false);
  const [loadingRequests, setLoadingRequests] = useState<boolean>(false);
  const [cashoutRequests, setCashoutRequests] = useState<ClaimCashoutRequest[]>([]);
  const [onChainPendingClaim, setOnChainPendingClaim] = useState<OnChainPendingClaim | null>(null);
  const [successModal, setSuccessModal] = useState<{
    type: "claim" | "withdraw";
    amount: number;
    txSig?: string;
    recipient?: string;
  } | null>(null);

  useEffect(() => {
    if (publicKey) {
      void fetchPrivateInitStatus({ silent: true });
      void fetchPrivateBalance({ silent: true, interactive: true });
      void fetchEmployeePayrollSummary({ silent: true, interactive: true });
    }
  }, [
    publicKey,
    fetchPrivateInitStatus,
    fetchPrivateBalance,
    fetchEmployeePayrollSummary,
  ]);

  const effectivePrivBalance = privBalance ?? "0";
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setVisiblePrivBalance(privBalance);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [privBalance]);

  const effectiveVisiblePrivBalance = visiblePrivBalance ?? effectivePrivBalance;
  const privBalanceNum = parseFloat(effectiveVisiblePrivBalance);
  const displayedPrivBalance = formatDisplayedUsdcBalance(privBalanceNum);
  const canUsePrivateBalance =
    privateAccountInitialized || privBalanceNum > 0;
  const primaryPayrollStream = payrollSummary?.streams?.[0];
  const primaryStreamId = primaryPayrollStream?.stream?.id ?? null;
  const hasPrivatePayrollMode =
    payrollSummary?.employees?.some(
      (employee) => employee.payrollMode === "private_payroll",
    ) ?? false;
  const canonicalSnapshot = primaryPayrollStream?.snapshot ?? null;
  const hasLiveSnapshot = Boolean(
    canonicalSnapshot && primaryPayrollStream?.liveState?.ready,
  );
  const liveClaimableMicros =
    hasLiveSnapshot && canonicalSnapshot
      ? Number(
          computeLiveClaimableAmountMicro({
            snapshot: canonicalSnapshot,
            nowMs: liveNowMs,
          }) ?? 0,
        ) || 0
      : 0;
  const liveClaimableUsdc = liveClaimableMicros / 1_000_000;
  const requestMaxUsdc = liveClaimableUsdc > 0 ? liveClaimableUsdc : 0;
  useEffect(() => {
    if (!publicKey) return;
    const correctionPollMs = hasLiveSnapshot ? 4000 : 8000;
    const poll = setInterval(() => {
      void fetchPrivateBalance({ silent: true });
      void fetchEmployeePayrollSummary({ silent: true, interactive: false });
    }, correctionPollMs);
    return () => clearInterval(poll);
  }, [
    publicKey,
    fetchPrivateBalance,
    fetchEmployeePayrollSummary,
    hasLiveSnapshot,
  ]);
  const pendingRequest = cashoutRequests.find((r) => r.status === "pending");
  const hasPendingRequest = !!pendingRequest || !!onChainPendingClaim;
  const claimDisabledReason = getClaimDisabledReason({
    registeredEmployeeWallet,
    privateAccountInitialized,
    hasPrimaryStreamId: Boolean(primaryStreamId),
    hasPrivatePayrollMode,
    hasPendingRequest,
    hasLiveSnapshot,
    requestMaxUsdc,
  });

  const fetchCashoutRequests = useCallback(
    async (silent = true) => {
      if (!publicKey || !signMessage) return;
      if (!silent) setLoadingRequests(true);
      try {
        const response = await walletAuthenticatedFetch({
          wallet: publicKey.toBase58(),
          signMessage,
          path: `/api/v1/history?scope=employee&wallet=${publicKey.toBase58()}`,
        });
        const json = (await response.json()) as {
          claimRecords?: any[];
          error?: string;
        };
        if (!response.ok)
          throw new Error(json.error || "Failed to load requests");
        
        const historyRecords = json.claimRecords || [];
        const mappedRequests = historyRecords.map((record) => ({
          id: record.id,
          requestedAmount: record.amount,
          createdAt: record.date,
          payoutMode: record.providerMeta?.action === "claim" ? "Claim" : "Withdrawal",
          status: record.status === "success" ? "fulfilled" : record.status === "failed" ? "dismissed" : "pending"
        }));
        
        setCashoutRequests(mappedRequests as ClaimCashoutRequest[]);

        if (primaryStreamId) {
          const claimRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://auraflow-backend-ulnl.onrender.com"}/api/v1/claim-salary/request?streamId=${primaryStreamId}`);
          const claimJson = (await claimRes.json()) as {
            pendingClaim?: OnChainPendingClaim | null;
          };
          if (claimRes.ok) {
            setOnChainPendingClaim(claimJson.pendingClaim || null);
          }
        }
      } catch (err: unknown) {
        if (!silent) toast.error(`Request history failed: ${getClaimErrorMessage(err)}`);
      } finally {
        if (!silent) setLoadingRequests(false);
      }
    },
    [publicKey, signMessage, primaryStreamId],
  );

  useEffect(() => {
    if (!publicKey || !signMessage || !primaryStreamId) return undefined;
    const timer = setTimeout(() => {
      void fetchCashoutRequests(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [publicKey, signMessage, primaryStreamId, fetchCashoutRequests]);

  const inputWithdrawRecipient =
    withdrawRecipient || publicKey?.toBase58() || "";
  const withdrawRecipientTrimmed = inputWithdrawRecipient.trim();

  const isValidWithdrawRecipient = useMemo(() => {
    if (!withdrawRecipientTrimmed) return false;
    return isValidStellarAddress(withdrawRecipientTrimmed);
  }, [withdrawRecipientTrimmed]);

  const isValidAmount = (() => {
    if (withdrawAmount.trim() === "") return true;
    const val = parseFloat(withdrawAmount);
    return !isNaN(val) && val > 0 && val <= privBalanceNum;
  })();

  useEffect(() => {
    if (withdrawAmount.trim() === "") {
      if (withdrawSyncNotice) {
        const timeoutId = window.setTimeout(() => {
          setWithdrawSyncNotice("");
        }, 0);
        return () => window.clearTimeout(timeoutId);
      }
      return;
    }
    const parsedAmount = parseFloat(withdrawAmount);
    if (Number.isNaN(parsedAmount) || parsedAmount <= privBalanceNum) {
      if (withdrawSyncNotice) {
        const timeoutId = window.setTimeout(() => {
          setWithdrawSyncNotice("");
        }, 0);
        return () => window.clearTimeout(timeoutId);
      }
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setWithdrawAmount(privBalanceNum > 0 ? privBalanceNum.toFixed(6) : "");
      setWithdrawSyncNotice(
        privBalanceNum > 0
          ? `Balance refreshed. Latest withdrawable amount is ${privBalanceNum.toFixed(6)} USDC.`
          : "Balance refreshed. Your private balance is now empty.",
      );
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [privBalanceNum, withdrawAmount, withdrawSyncNotice]);

  const isOwnWalletDestination = useMemo(() => {
    if (!publicKey || !isValidWithdrawRecipient) return false;
    return withdrawRecipientTrimmed === publicKey.toBase58();
  }, [publicKey, withdrawRecipientTrimmed, isValidWithdrawRecipient]);

  const handleWithdraw = async () => {
    if (!publicKey || !signTransaction) return;
    setWithdrawing(true);
    const withdrawToastId = "employee-withdraw-toast";
    toast.loading("Preparing withdrawal...", { id: withdrawToastId });
    let activeToken: string | null = null;
    try {
      activeToken = await getOrFetchToken();
      if (!activeToken) throw new Error("Authentication failed");

      const amountToWithdraw =
        withdrawAmount.trim() === ""
          ? privBalanceNum
          : parseFloat(withdrawAmount);
      const latestPrivateBalance = await getPrivateBalance(
        publicKey.toBase58(),
        activeToken,
      );
      const latestPrivateBalanceMicro =
        parseInt(latestPrivateBalance.balance ?? "0", 10) || 0;
      const latestPrivateBalanceUi =
        latestPrivateBalanceMicro > 0
          ? (latestPrivateBalanceMicro / 1_000_000).toFixed(6)
          : "0";
      setVisiblePrivBalance(latestPrivateBalanceUi);
      const amountToWithdrawMicro = Math.round(amountToWithdraw * 1_000_000);

      if (amountToWithdrawMicro <= 0) {
        throw new Error("Enter a valid withdrawal amount.");
      }

      if (latestPrivateBalanceMicro < amountToWithdrawMicro) {
        setWithdrawAmount(
          latestPrivateBalanceMicro > 0 ? latestPrivateBalanceUi : "",
        );
        setWithdrawSyncNotice(
          latestPrivateBalanceMicro > 0
            ? `Balance refreshed. Latest withdrawable amount is ${latestPrivateBalanceUi} USDC.`
            : "Balance refreshed. Your private balance is now empty.",
        );
        void fetchPrivateBalance({ silent: true });
        throw new Error(
          latestPrivateBalanceMicro === 0
            ? "Your private balance is already empty. Refresh completed state and try again."
            : `Private balance changed. Latest available balance is ${latestPrivateBalanceUi} USDC.`,
        );
      }

      const expectedAmountMicro = Math.round(amountToWithdraw * 1_000_000);
      const baseBalanceBefore = isOwnWalletDestination
        ? await getBalance(publicKey.toBase58()).catch(() => null)
        : null;
      let buildRes;
      if (isOwnWalletDestination) {
        // Use sponsored withdraw — Sponsor wallet pays all SOL fees
        const sponsorRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://auraflow-backend-ulnl.onrender.com"}/api/v1/sponsor-withdraw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: publicKey.toBase58(),
            amount: amountToWithdraw,
            token: activeToken,
          }),
        });
        if (!sponsorRes.ok) {
          const errBody = await sponsorRes.json().catch(() => ({}));
          throw new Error(errBody.error || "Sponsored withdrawal failed");
        }
        buildRes = await sponsorRes.json();
      } else {
        buildRes = await privateTransfer(
          publicKey.toBase58(),
          withdrawRecipientTrimmed,
          amountToWithdraw,
          undefined,
          activeToken,
          {
            fromBalance: "ephemeral",
            toBalance: "base",
          },
        );
      }

      if (!buildRes.transactionBase64) {
        throw new Error("API did not return a transaction");
      }

      const txSignature = await signAndSend(buildRes.transactionBase64, signTransaction, {
        sendTo: buildRes.sendTo || "base",
      });

      let baseCredited = false;
      if (isOwnWalletDestination) {
        const baseBeforeMicro = parseInt(baseBalanceBefore?.balance ?? "0", 10) || 0;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const latestBase = await getBalance(publicKey.toBase58()).catch(() => null);
          const latestBaseMicro = parseInt(latestBase?.balance ?? "0", 10) || 0;
          if (latestBaseMicro >= baseBeforeMicro + expectedAmountMicro) {
            baseCredited = true;
            break;
          }
        }
      }

      if (isOwnWalletDestination) {
        if (baseCredited) {
          toast.success("Withdrawal successful!", { id: withdrawToastId });
          setSuccessModal({
            type: "withdraw",
            amount: amountToWithdraw,
            txSig: txSignature,
            recipient: withdrawRecipientTrimmed,
          });
        } else {
          toast.warning(
            "Transaction was submitted, but the base-wallet credit is not visible yet. Refresh your wallet and balances.",
            { id: withdrawToastId },
          );
          setSuccessModal({
            type: "withdraw",
            amount: amountToWithdraw,
            txSig: txSignature,
            recipient: withdrawRecipientTrimmed,
          });
        }
      } else {
        toast.success("External wallet transfer successful!", { id: withdrawToastId });
        setSuccessModal({
          type: "withdraw",
          amount: amountToWithdraw,
          txSig: txSignature,
          recipient: withdrawRecipientTrimmed,
        });
      }

      if (signMessage !== undefined) {
        try {
          await walletAuthenticatedFetch({
            path: `/api/v1/history?wallet=${publicKey.toBase58()}`,
            method: "POST",
            signMessage,
            wallet: publicKey.toBase58(),
            body: {
              kind: "claim-record",
              wallet: publicKey.toBase58(),
              amount: amountToWithdraw,
              recipient: withdrawRecipientTrimmed,
              txSig: txSignature,
              status:
                isOwnWalletDestination && !baseCredited ? "submitted" : "success",
              privacyConfig: {
                visibility: "private",
                fromBalance: "ephemeral",
                toBalance: "base",
                destinationStrategy: isOwnWalletDestination
                  ? "connected-wallet"
                  : "custom-address",
              },
              providerMeta: {
                provider: "auraflow",
                sendTo:
                  typeof buildRes.sendTo === "string" ? buildRes.sendTo : undefined,
                action: isOwnWalletDestination
                  ? "employee-withdrawal"
                  : "employee-external-transfer",
                destinationWallet: withdrawRecipientTrimmed,
                creditVerified: isOwnWalletDestination ? baseCredited : true,
              },
            },
          });
        } catch (historyErr) {
          console.error("Failed to save withdraw history", historyErr);
        }
      }
      setWithdrawAmount("");
      setWithdrawSyncNotice("");
      void fetchPrivateBalance({ silent: true });
      void fetchEmployeePayrollSummary({
        silent: true,
        force: true,
        interactive: false,
      });
    } catch (err: unknown) {
      const rawMessage = getClaimErrorMessage(err);
      const isPriorCreditError =
        rawMessage.includes(
          "Attempt to debit an account but found no record of a prior credit",
        ) ||
        rawMessage.toLowerCase().includes("prior credit");

      if (isPriorCreditError) {
        setWithdrawSyncNotice(
          "Your private balance changed while the transaction was being prepared. The UI is refreshing to the latest available amount.",
        );
        if (activeToken && publicKey) {
          void getPrivateBalance(publicKey.toBase58(), activeToken)
            .then((balance: { balance?: string }) => {
              const latestMicro = parseInt(balance.balance ?? "0", 10) || 0;
              setVisiblePrivBalance(
                latestMicro > 0 ? (latestMicro / 1_000_000).toFixed(6) : "0",
              );
            })
            .catch(() => undefined);
        }
        void fetchPrivateBalance({ silent: true });
        void fetchEmployeePayrollSummary({
          silent: true,
          force: true,
          interactive: false,
        });
      }

      const message = isPriorCreditError
        ? "Your private balance is no longer available for this withdrawal. The UI has been refreshed with the latest state."
        : rawMessage;
      toast.error(`Transaction failed: ${message}`, { id: withdrawToastId });
      if (publicKey && signMessage !== undefined) {
        try {
          await walletAuthenticatedFetch({
            path: `/api/v1/history?wallet=${publicKey.toBase58()}`,
            method: "POST",
            signMessage,
            wallet: publicKey.toBase58(),
            body: {
              kind: "claim-record",
              wallet: publicKey.toBase58(),
              amount:
                withdrawAmount.trim() === ""
                  ? privBalanceNum
                  : parseFloat(withdrawAmount) || 0,
              recipient: withdrawRecipientTrimmed || publicKey.toBase58(),
              status: "failed",
              privacyConfig: {
                visibility: "private",
                fromBalance: "ephemeral",
                toBalance: "base",
                destinationStrategy: isOwnWalletDestination
                  ? "connected-wallet"
                  : "custom-address",
              },
              providerMeta: {
                provider: "auraflow",
                action: isOwnWalletDestination
                  ? "employee-withdrawal"
                  : "employee-external-transfer",
                destinationWallet: withdrawRecipientTrimmed || publicKey.toBase58(),
                creditVerified: false,
                errorMessage: message,
              },
            },
          });
        } catch (historyErr) {
          console.error("Failed to save failed withdraw history", historyErr);
        }
      }
    } finally {
      setWithdrawing(false);
    }
  };



  const handleInitialize = async () => {
    if (!publicKey || !signTransaction || !signMessage) return;
    setInitializingPrivateAccount(true);
    try {
      const currentStatus = await fetch(
        "/api/v1/employees/private-init?employeeWallet=" + publicKey.toBase58(),
      );
      const currentStatusJson = await currentStatus.json();
      if (currentStatus.ok && currentStatusJson.initialized) {
        toast.success("Private vault is already initialized");
        void fetchPrivateInitStatus({ silent: true });
        return;
      }

      const buildRes = await walletAuthenticatedFetch({
        wallet: publicKey.toBase58(),
        signMessage,
        path: "/api/v1/employees/private-init",
        method: "POST",
        body: { employeeWallet: publicKey.toBase58() },
      });
      const buildJson = await buildRes.json();
      if (!buildRes.ok)
        throw new Error(buildJson.error || "Failed to build init tx");

      const signature = await signAndSend(
        buildJson.transaction.transactionBase64,
        signTransaction,
        {
          sendTo: buildJson.transaction.sendTo,
        },
      );

      const patchRes = await walletAuthenticatedFetch({
        wallet: publicKey.toBase58(),
        signMessage,
        path: "/api/v1/employees/private-init",
        method: "PATCH",
        body: {
          employeeWallet: publicKey.toBase58(),
          txSignature: signature,
        },
      });
      if (!patchRes.ok) throw new Error("Failed to finalize initialization");

      toast.success("Private vault initialized!");
      void fetchPrivateInitStatus({ silent: false });
    } catch (err: unknown) {
      const message = getClaimErrorMessage(err);
      const isAlreadyInitializedLikeError =
        message.includes(
          "Attempt to debit an account but found no record of a prior credit",
        ) ||
        message.toLowerCase().includes("already in use") ||
        message.toLowerCase().includes("already initialized");

      if (isAlreadyInitializedLikeError) {
        await walletAuthenticatedFetch({
          wallet: publicKey.toBase58(),
          signMessage,
          path: "/api/v1/employees/private-init",
          method: "PATCH",
          body: { employeeWallet: publicKey.toBase58() },
        }).catch(() => undefined);
        toast.success("Private vault was already initialized. Synced status.");
        void fetchPrivateInitStatus({ silent: true });
        return;
      }
      toast.error(`Init failed: ${message}`);
    } finally {
      setInitializingPrivateAccount(false);
    }
  };


  const handleClaimSalary = async () => {
    if (!publicKey || !signTransaction || !signMessage || !primaryPayrollStream?.stream) return;
    
    let amount = parseFloat(requestAmount);
    // Auto-fill max amount if empty or invalid but max is available
    if (isNaN(amount) || amount <= 0) {
      if (requestMaxUsdc > 0) {
        amount = requestMaxUsdc;
        setRequestAmount(requestMaxUsdc.toFixed(6));
      } else {
        toast.error("Please enter a valid amount");
        return;
      }
    }

    if (!hasLiveSnapshot) {
      toast.error("Live PER snapshot is required. Refresh and sign first.");
      return;
    }
    if (requestMaxUsdc > 0 && amount > requestMaxUsdc) {
      toast.error(`Request exceeds max claimable (${requestMaxUsdc.toFixed(6)} USDC)`);
      return;
    }

    setSubmittingRequest(true);
    try {
      const token = await getOrFetchToken();
      if (!token) throw new Error("Authentication failed");

      // Build on-chain `request_withdrawal` transaction.
      const buildRes = await walletAuthenticatedFetch({
        wallet: publicKey.toBase58(),
        signMessage,
        path: "/api/v1/claim-salary/request",
        method: "POST",
        body: {
          employeeWallet: publicKey.toBase58(),
          streamId: primaryPayrollStream.stream.id,
          amountMicro: Math.round(amount * 1_000_000),
          teeAuthToken: token,
        },
      });
      const buildJson = await buildRes.json();
      if (!buildRes.ok) throw new Error(buildJson.error || "Failed to build claim tx");

      // Sign with wallet and submit to the TEE endpoint.
      const signature = await signAndSend(
        buildJson.transactions.requestWithdrawal.transactionBase64,
        signTransaction,
        { sendTo: "ephemeral", rpcUrl: `https://tee.auraflow.finance?token=${encodeURIComponent(token)}`, signMessage, publicKey }
      );

      // Persist claim metadata so backend payout reconciliation can continue.
      const patchRes = await walletAuthenticatedFetch({
        wallet: publicKey.toBase58(),
        signMessage,
        path: "/api/v1/claim-salary/request",
        method: "PATCH",
        body: {
          employeeWallet: publicKey.toBase58(),
          streamId: primaryPayrollStream.stream.id,
          amountMicro: Math.round(amount * 1_000_000),
          claimId: buildJson.claimId,
          signature,
          teeAuthToken: token,
        },
      });
      const patchJson = await patchRes.json();
      if (!patchRes.ok) throw new Error(patchJson.error || "Failed to save claim");

      toast.success("Claim submitted successfully!");
      setRequestAmount("");

      // Trigger server-side payout processing immediately after claim submission.
      toast.loading("Processing payout...", { id: "payout-toast" });
      const processRes = await walletAuthenticatedFetch({
        wallet: publicKey.toBase58(),
        signMessage,
        path: "/api/v1/claim-salary/process",
        method: "POST",
        body: {
          streamId: primaryPayrollStream.stream.id,
          teeAuthToken: token,
          employeeWallet: publicKey.toBase58(),
          amountMicro: Math.round(amount * 1_000_000),
        },
      });
      const processJson = await processRes.json();

      if (!processRes.ok) {
        toast.error("Claim is stuck. Please click Sync Claim State later.", { id: "payout-toast" });
      } else {
        toast.success("Claim paid successfully!", { id: "payout-toast" });

        // Show success modal
        setSuccessModal({
          type: "claim",
          amount: parseFloat(requestAmount) || 0,
          txSig: processJson.claim?.paymentTxSignature || signature,
        });

        // Save the claim record to history so it shows up in Income tab
        try {
          const claimAmountUsdc = parseFloat(requestAmount) || 0;
          await walletAuthenticatedFetch({
            path: `/api/v1/history?wallet=${publicKey.toBase58()}`,
            method: "POST",
            signMessage,
            wallet: publicKey.toBase58(),
            body: {
              kind: "claim-record",
              wallet: publicKey.toBase58(),
              amount: claimAmountUsdc,
              recipient: publicKey.toBase58(),
              txSig: processJson?.claim?.paymentTxSignature || processJson?.claim?.markPaidTxSignature || undefined,
              status: "success",
              privacyConfig: {
                visibility: "private",
                fromBalance: "ephemeral",
                toBalance: "ephemeral",
              },
              providerMeta: {
                provider: "auraflow",
                action: "claim",
                destinationWallet: publicKey.toBase58(),
                creditVerified: true,
              },
            },
          });
        } catch (historyErr) {
          console.error("Failed to save claim history", historyErr);
        }
      }

      setSubmittingRequest(false);
      void fetchCashoutRequests(false);
    } catch (err: unknown) {
      toast.error(`Claim failed: ${getClaimErrorMessage(err)}`);
      setSubmittingRequest(false);
    }
  };

  const [syncingClaim, setSyncingClaim] = useState(false);
  const [cancellingClaim, setCancellingClaim] = useState(false);

  const handleSyncClaim = async () => {
    if (!publicKey || !signMessage || !primaryPayrollStream?.stream?.id) return;
    setSyncingClaim(true);
    toast.loading("Syncing claim state...", { id: "sync-toast" });
    try {
      const token = await getOrFetchToken();
      if (!token) throw new Error("Authentication failed");
      const processRes = await walletAuthenticatedFetch({
        wallet: publicKey.toBase58(),
        signMessage,
        path: "/api/v1/claim-salary/process",
        method: "POST",
        body: {
          streamId: primaryPayrollStream.stream.id,
          teeAuthToken: token,
          employeeWallet: publicKey.toBase58(),
        },
      });
      const processJson = await processRes.json();

      if (!processRes.ok) {
        throw new Error(processJson.error || "Failed to sync claim");
      }
      toast.success("Claim synced successfully!", { id: "sync-toast" });
      await fetchCashoutRequests(false);
    } catch (err: unknown) {
      toast.error(`Sync failed: ${getClaimErrorMessage(err)}`, { id: "sync-toast" });
    } finally {
      setSyncingClaim(false);
    }
  };

  const handleCancelClaim = async () => {
    if (!publicKey || !signMessage || !primaryPayrollStream?.stream?.id) return;
    setCancellingClaim(true);
    toast.loading("Cancelling claim...", { id: "cancel-claim-toast" });
    try {
      const token = await getOrFetchToken();
      if (!token) throw new Error("Authentication failed");
      const cancelRes = await walletAuthenticatedFetch({
        wallet: publicKey.toBase58(),
        signMessage,
        path: "/api/v1/claim-salary/cancel",
        method: "POST",
        body: {
          streamId: primaryPayrollStream.stream.id,
          teeAuthToken: token,
          employeeWallet: publicKey.toBase58(),
        },
      });
      const cancelJson = await cancelRes.json();

      if (!cancelRes.ok) {
        throw new Error(cancelJson.error || "Failed to cancel claim");
      }

      toast.success("Claim cancelled successfully.", { id: "cancel-claim-toast" });
      await Promise.all([
        fetchCashoutRequests(false),
        fetchEmployeePayrollSummary({ silent: true, interactive: false }),
      ]);
    } catch (err: unknown) {
      toast.error(`Cancel failed: ${getClaimErrorMessage(err)}`, {
        id: "cancel-claim-toast",
      });
    } finally {
      setCancellingClaim(false);
    }
  };

  return (
    <EmployeeLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 flex flex-col items-center">
        <div className="mb-8 flex w-full flex-col items-center text-center">
          <div className="mb-6 flex w-fit rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-xl">
            <Link
              href="/claim/dashboard"
              className="flex h-9 min-w-[108px] items-center justify-center rounded-full px-4 text-[10px] font-bold uppercase tracking-wider text-[#8f8f95] transition-all hover:bg-white/10 hover:text-white no-underline"
            >
              Home
            </Link>
            <Link
              href="/claim/balances"
              className="flex h-9 min-w-[108px] items-center justify-center rounded-full px-4 text-[10px] font-bold uppercase tracking-wider text-[#8f8f95] transition-all hover:bg-white/10 hover:text-white no-underline"
            >
              Balances
            </Link>
            <button className="h-9 min-w-[108px] rounded-full bg-[#a855f7] px-4 text-[10px] font-bold uppercase tracking-wider text-black shadow-sm transition-all">
              Withdraw
            </button>
          </div>
          
          <h1 className="font-heading text-3xl font-bold tracking-tight text-white">
            Wallet
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-[#a8a8aa]">
            Manage your private salary and withdrawals.
          </p>
        </div>

        <div className="mb-6 w-full rounded-[32px] border border-white/10 bg-gradient-to-b from-white/10 to-white/5 p-8 text-center shadow-2xl backdrop-blur-md">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f8f95]">
            Private Balance
          </p>
          <div className="mt-3 flex items-center justify-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center border border-white/10 shrink-0 shadow-sm">
              <img src="/usdc-logo.png" alt="USDC" className="w-6 h-6 object-contain" />
            </div>
            <p className="text-4xl font-bold text-white tracking-tight">
              {displayedPrivBalance} <span className="text-xl text-[#a8a8aa] font-medium">USDC</span>
            </p>
          </div>
        </div>

        <div className="w-full flex flex-col gap-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 w-full">
            <div className="order-2 rounded-[32px] border border-white/10 bg-[#0b0b0d] p-5 shadow-[0_10px_40px_rgba(0,0,0,0.4)] sm:p-6 flex flex-col justify-between lg:order-2">
              <div className="space-y-6">
                <div>
                  <label className="mb-3 block px-1 text-[10px] font-bold uppercase tracking-widest text-[#8f8f95]">
                    Destination Wallet
                  </label>
                  <div className="group rounded-2xl border border-white/10 bg-white/5 px-5 py-3.5 shadow-inner transition-all focus-within:border-[#a855f7]/40">
                    <input
                      type="text"
                      placeholder="Enter Stellar address (G...)"
                      value={inputWithdrawRecipient}
                      onChange={(e) => setWithdrawRecipient(e.target.value)}
                      disabled={!canUsePrivateBalance}
                      className="w-full bg-transparent text-sm font-bold text-white outline-none placeholder:text-[#62626b]"
                    />
                  </div>
                  <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-1">
                    <div className="flex items-center gap-2">
                      <Info size={12} className="text-[#8f8f95]" />
                      <p className="text-[10px] font-medium italic text-[#8f8f95]">
                        {isOwnWalletDestination
                          ? "Direct withdrawal to your base wallet."
                          : "Transfer from your private balance to the destination wallet's base balance."}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setWithdrawRecipient(publicKey?.toBase58() ?? "")
                      }
                      disabled={!canUsePrivateBalance}
                      className="text-[10px] font-bold uppercase tracking-wider text-[#a855f7] transition-colors hover:text-[#64f0ce]"
                    >
                      Use My Wallet
                    </button>
                  </div>
                  {withdrawRecipientTrimmed && !isValidWithdrawRecipient && (
                    <p className="mt-2 px-1 text-[10px] font-bold text-red-300">
                      Invalid Stellar address format
                    </p>
                  )}
                </div>

                <div>
                  <label className="mb-3 block px-1 text-[10px] font-bold uppercase tracking-widest text-[#8f8f95]">
                    {isOwnWalletDestination
                      ? "Amount to Withdraw"
                      : "Amount to Send"}
                  </label>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-3.5 shadow-inner transition-all focus-within:border-[#a855f7]/40">
                    <input
                      type="number"
                      placeholder={`Max ${privBalanceNum.toString()}`}
                      value={withdrawAmount}
                      onChange={(e) => {
                        setWithdrawAmount(e.target.value);
                        if (withdrawSyncNotice) setWithdrawSyncNotice("");
                      }}
                      disabled={!canUsePrivateBalance}
                      className="flex-1 bg-transparent text-lg font-bold text-white outline-none placeholder:text-[#62626b]"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <img src="/usdc-logo.png" alt="USDC" className="w-4 h-4 object-contain" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[#8f8f95]">
                        USDC
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setWithdrawAmount(privBalanceNum.toString())
                      }
                      disabled={
                        !canUsePrivateBalance || privBalanceNum <= 0
                      }
                      className="text-[10px] font-bold uppercase tracking-wider text-[#a855f7] transition-colors hover:text-[#64f0ce]"
                    >
                      Max
                    </button>
                  </div>
                  {withdrawAmount &&
                    parseFloat(withdrawAmount) > privBalanceNum && (
                      <p className="mt-2 px-1 text-[10px] font-bold text-red-300">
                        Insufficient private balance
                      </p>
                    )}
                  {withdrawSyncNotice && (
                    <p className="mt-2 px-1 text-[10px] font-bold text-amber-200">
                      {withdrawSyncNotice}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-3 pt-2 sm:flex-row">
                  {!canUsePrivateBalance ? (
                    <button
                      onClick={handleInitialize}
                      disabled={
                        initializingPrivateAccount || !registeredEmployeeWallet
                      }
                      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border py-4 text-[11px] font-bold uppercase tracking-widest transition-all disabled:opacity-40 disabled:animate-none disabled:scale-100 ${
                        !canUsePrivateBalance && registeredEmployeeWallet
                          ? "bg-emerald-500 border-emerald-400 text-black hover:bg-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.6)] ring-2 ring-emerald-500 ring-offset-4 ring-offset-[#0b0b0d] animate-pulse hover:animate-none scale-[1.02]"
                          : "border-amber-300/30 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                      }`}
                    >
                      {initializingPrivateAccount ? (
                        <Loader2 className="animate-spin" size={16} />
                      ) : (
                        <ShieldCheck size={16} />
                      )}
                      {registeredEmployeeWallet
                        ? "Initialize Private Wallet"
                        : "No Employee Setup"}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => void fetchPrivateBalance()}
                        disabled={loading || withdrawing}
                        className="flex h-14 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 text-[11px] font-bold uppercase tracking-widest text-white transition-all hover:bg-white/10"
                      >
                        {loading ? (
                          <Loader2 className="animate-spin" size={16} />
                        ) : (
                          <RefreshCw size={16} />
                        )}
                      </button>
                      <button
                        onClick={handleWithdraw}
                        disabled={
                          withdrawing ||
                          privBalanceNum <= 0 ||
                          !isValidWithdrawRecipient ||
                          (withdrawAmount.trim() !== "" && !isValidAmount)
                        }
                        className={`flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-[#a855f7] px-6 text-[11px] font-bold uppercase tracking-widest text-black transition-all hover:bg-[#9333ea] disabled:opacity-30 disabled:animate-none disabled:scale-100 ${
                          privBalanceNum >= 0.000001 && requestMaxUsdc < 0.000001 && isValidWithdrawRecipient && isValidAmount && !withdrawing
                            ? "shadow-[0_0_40px_rgba(168,85,247,0.6)] ring-2 ring-[#a855f7] ring-offset-4 ring-offset-[#0b0b0d] animate-pulse hover:animate-none scale-[1.02]"
                            : "shadow-lg"
                        }`}
                      >
                        {withdrawing ? (
                          <Loader2 className="animate-spin" size={16} />
                        ) : (
                          <LogOut size={16} />
                        )}
                        {withdrawAmount.trim() === ""
                          ? "Withdraw Full Balance"
                          : `Confirm ${isOwnWalletDestination ? "Withdraw" : "Transfer"}`}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="order-1 rounded-[32px] border border-white/10 bg-[#0b0b0d] p-5 shadow-[0_10px_40px_rgba(0,0,0,0.4)] sm:p-6 flex flex-col justify-between lg:order-1">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">
                    Claim Salary
                  </h3>
                  <button
                    onClick={() => void fetchCashoutRequests(false)}
                    disabled={loadingRequests}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#a8a8aa] transition-all hover:bg-white/10 disabled:opacity-40"
                  >
                    {loadingRequests ? (
                      <Loader2 className="animate-spin" size={12} />
                    ) : (
                      <RefreshCw size={12} />
                    )}
                    Refresh
                  </button>
                </div>

	              {onChainPendingClaim && ["needs_sync", "paying"].includes(onChainPendingClaim.status) ? (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3">
	                  <p className="text-xs font-bold text-rose-200 mb-2">
                      {onChainPendingClaim.status === "needs_sync"
	                      ? "Your last payout reached your private balance, but the final bookkeeping step still needs to sync."
	                      : "Your claim is processing now. If it stays stuck for a while, you can finish the sync here."}
	                  </p>
                    <button
                      onClick={handleSyncClaim}
                      disabled={syncingClaim}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 py-2 text-[10px] font-bold uppercase tracking-widest text-black transition-all hover:bg-rose-400 disabled:opacity-40"
                    >
                      {syncingClaim ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                      Sync Claim State
                    </button>
                  </div>
                ) : null}

                {onChainPendingClaim && onChainPendingClaim.status === "failed" ? (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                    <p className="text-xs font-bold text-red-200 mb-2">
                      Your claim payout failed, likely due to insufficient funds in your employer&apos;s treasury. You can retry the payout.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={handleSyncClaim}
                        disabled={syncingClaim || cancellingClaim}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-500 py-2 text-[10px] font-bold uppercase tracking-widest text-black transition-all hover:bg-red-400 disabled:opacity-40"
                      >
                        {syncingClaim ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                        Retry Payout
                      </button>
                      <button
                        onClick={handleCancelClaim}
                        disabled={syncingClaim || cancellingClaim}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-300/40 bg-transparent py-2 text-[10px] font-bold uppercase tracking-widest text-red-100 transition-all hover:bg-red-400/10 disabled:opacity-40"
                      >
                        {cancellingClaim ? <Loader2 className="animate-spin" size={14} /> : <LogOut size={14} />}
                        Cancel Claim
                      </button>
                    </div>
                  </div>
                ) : null}

                {onChainPendingClaim && onChainPendingClaim.status === "requested" ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                    <p className="text-xs font-bold text-amber-200 mb-2">
                      Your claim is still pending on the payroll engine. You can wait for payout processing or cancel it to restore the amount back into claimable balance.
                    </p>
                    <button
                      onClick={handleCancelClaim}
                      disabled={cancellingClaim}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-amber-300/40 bg-transparent py-2 text-[10px] font-bold uppercase tracking-widest text-amber-100 transition-all hover:bg-amber-400/10 disabled:opacity-40"
                    >
                      {cancellingClaim ? <Loader2 className="animate-spin" size={14} /> : <LogOut size={14} />}
                      Cancel Pending Claim
                    </button>
                  </div>
                ) : null}

	              {hasPendingRequest && (!onChainPendingClaim || !["requested", "needs_sync", "paying", "failed"].includes(onChainPendingClaim.status)) ? (
	                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
	                  <p className="text-xs font-bold text-amber-200">
	                    You already have a claim in progress. Wait for it to settle before starting another.
	                  </p>
	                </div>
	              ) : null}

                <div>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 shadow-inner transition-all focus-within:border-[#a855f7]/40">
                      <input
                        type="number"
                        min="0.000001"
                        step="0.000001"
                        placeholder={`Max ${requestMaxUsdc.toFixed(6)} USDC`}
                        value={requestAmount}
                        onChange={(e) => setRequestAmount(e.target.value)}
                        className="flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-[#62626b]"
                      />
                      <button
                        type="button"
                        onClick={() => setRequestAmount(requestMaxUsdc.toFixed(6))}
                        disabled={requestMaxUsdc <= 0}
                        className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#a855f7] transition-colors hover:text-[#64f0ce] disabled:opacity-30"
                      >
                        Max
                      </button>
                    </div>
                  </div>
                  {!hasLiveSnapshot ? (
                    <p className="mt-2.5 text-[11px] text-amber-300">
                      Claiming unlocks after your employer finishes payroll setup and live salary sync is available.
                    </p>
                  ) : null}
                  <div className="mt-2 flex items-center justify-between px-1">
                    <p className="text-[10px] text-[#8f8f95]">
                      Live claimable now:{" "}
                      <span className="font-bold text-[#64f0ce]">
                        {hasLiveSnapshot ? `${liveClaimableUsdc.toFixed(6)} USDC` : "—"}
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setRequestAmount(requestMaxUsdc.toFixed(6))}
                      disabled={requestMaxUsdc <= 0}
                      className="text-[10px] font-bold uppercase tracking-wider text-[#a855f7] transition-colors hover:text-[#64f0ce] disabled:opacity-30"
                    >
                      Use Max
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-4">
                <div>
                  <p className="mb-3 text-center text-[10px] text-[#62626b]">
                    Claimed salary lands in your private balance first, then you can withdraw it whenever you want.
                  </p>
                  {claimDisabledReason ? (
                    <p className="mb-3 text-center text-[11px] text-amber-300">
                      {claimDisabledReason}
                    </p>
                  ) : null}
                  <button
                    onClick={handleClaimSalary}
                    disabled={
                      submittingRequest ||
                      !publicKey ||
                      !registeredEmployeeWallet ||
                      !privateAccountInitialized ||
                      !primaryPayrollStream?.stream?.id ||
                      !hasLiveSnapshot ||
                      requestMaxUsdc <= 0 ||
                      hasPendingRequest
                    }
                    className={`flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#a855f7] px-6 text-[11px] font-bold uppercase tracking-widest text-black transition-all hover:bg-[#9333ea] disabled:opacity-30 disabled:animate-none disabled:scale-100 ${
                      requestMaxUsdc >= 0.000001 && !hasPendingRequest && hasLiveSnapshot
                        ? "shadow-[0_0_40px_rgba(168,85,247,0.6)] ring-2 ring-[#a855f7] ring-offset-4 ring-offset-[#0b0b0d] animate-pulse hover:animate-none scale-[1.02]"
                        : "shadow-sm"
                    }`}
                  >
                    {submittingRequest ? (
                      <Loader2 className="animate-spin" size={16} />
                    ) : (
                      <Send size={16} />
                    )}
                    {hasPendingRequest ? "Pending..." : "Claim Salary"}
                  </button>
                </div>
              </div>
            </div>
          </div>


        </div>
      </div>

      {successModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setSuccessModal(null)}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

          <div
            className="relative w-full max-w-md rounded-[2.5rem] border border-white/10 bg-[#0b0b0d] p-8 shadow-[0_10px_40px_rgba(0,0,0,0.8)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSuccessModal(null)}
              className="absolute right-6 top-6 rounded-xl p-2 text-[#62626b] transition-colors hover:bg-white/5 hover:text-white"
            >
              <X size={18} />
            </button>

            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#a855f7]/20 bg-[#a855f7]/10">
              <CheckCircle2 size={28} className="text-[#a855f7]" />
            </div>

            <h2 className="mb-1 text-2xl font-bold text-white">
              {successModal.type === "claim" ? "Salary Claimed" : "Withdrawal Complete"}
            </h2>
            <p className="mb-8 text-sm text-[#8f8f95]">
              {successModal.type === "claim" 
                ? "Your salary has been successfully claimed to your private balance."
                : `Your withdrawal to ${successModal.recipient || "your wallet"} was processed successfully.`}
            </p>

            <div className="mb-8 rounded-2xl border border-white/5 bg-white/5 p-4">
              <p className="mb-1 text-xs uppercase tracking-wider text-[#8f8f95]">
                Amount
              </p>
              <p className="text-xl font-bold text-white">
                {successModal.amount.toFixed(6)}{" "}
                <span className="text-sm font-medium text-[#a855f7]">
                  USDC
                </span>
              </p>
            </div>

            {successModal.txSig && (
              <div className="mb-8 space-y-2">
                <a
                  href={`https://stellarchain.io/transactions/${successModal.txSig}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3 transition-all hover:border-white/10 hover:bg-white/10"
                >
                  <span className="font-mono text-xs text-[#8f8f95] transition-colors group-hover:text-white">
                    Transaction
                  </span>
                  <div className="flex items-center gap-1.5 font-mono text-xs text-[#a855f7]">
                    {successModal.txSig.slice(0, 8)}...
                    <ExternalLink size={11} />
                  </div>
                </a>
              </div>
            )}

            {publicKey && (
              <div className="mb-8 space-y-2">
                <a
                  href={`https://stellarchain.io/accounts/${publicKey.toBase58()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3 transition-all hover:border-white/10 hover:bg-white/10"
                >
                  <span className="font-mono text-xs text-[#8f8f95] transition-colors group-hover:text-white">
                    Devnet USDC Balance
                  </span>
                  <div className="flex items-center gap-1.5 font-mono text-xs text-[#a855f7]">
                    {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
                    <ExternalLink size={11} />
                  </div>
                </a>
              </div>
            )}

            <button
              onClick={() => setSuccessModal(null)}
              className="w-full rounded-2xl bg-[#a855f7] py-3.5 text-sm font-bold text-black transition-colors hover:bg-[#9333ea]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </EmployeeLayout>
  );
}
