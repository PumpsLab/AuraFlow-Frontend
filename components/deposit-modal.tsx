import { useState, useEffect, useCallback } from "react";
import { Loader2, X, Wallet, CheckCircle2, ExternalLink, ShieldCheck, Copy, AlertCircle, Coins } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { walletAuthenticatedFetch } from "@/lib/wallet/wallet-auth-fetch";
import { toast } from "sonner";
import Link from "next/link";
import * as StellarSdk from "@stellar/stellar-sdk";

type FundingStep = {
  step: number;
  label: string;
  description: string;
  status: "pending" | "ready" | "blocked" | "completed";
  treasuryPubkey?: string;
  xlmBalance?: string;
  usdcBalance?: string;
  requiresXlm?: boolean;
};

type FundingInstructions = {
  ok: boolean;
  treasuryPubkey: string;
  currency: string;
  isReady: boolean;
  steps: FundingStep[];
};

type TreasuryBalance = { xlm: string; usdc: string; hasTrustline: boolean };

export function DepositModal({
  isOpen,
  onClose,
  baseBalance = 0,
  privateBalance = 0,
  onDepositSuccess,
  treasuryPubkey,
  companyId,
}: {
  isOpen: boolean;
  onClose: () => void;
  baseBalance?: number;
  privateBalance?: number;
  onDepositSuccess?: () => void;
  treasuryPubkey?: string;
  companyId?: string;
}) {
  const { publicKey, signMessage, signTransaction } = useWallet();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [successSig, setSuccessSig] = useState<string | null>(null);
  const [depositedAmount, setDepositedAmount] = useState<number | null>(null);
  const [instructions, setInstructions] = useState<FundingInstructions | null>(null);
  const [treasuryBalance, setTreasuryBalance] = useState<TreasuryBalance | null>(null);
  const [liveBaseBalance, setLiveBaseBalance] = useState(baseBalance);

  useEffect(() => { setLiveBaseBalance(baseBalance); }, [baseBalance]);

  // Live wallet USDC balance via Horizon
  useEffect(() => {
    if (!isOpen || !publicKey) return;
    let cancelled = false;
    (async () => {
      try {
        const { Horizon } = await import("@stellar/stellar-sdk");
        const { HORIZON_URL, USDC_ISSUER } = await import("@/lib/wallet/contract-config");
        const server = new Horizon.Server(HORIZON_URL);
        const account = await server.loadAccount(publicKey);
        const usdc = (account.balances as Array<{ asset_code?: string; asset_issuer?: string; balance: string }>).find(
          (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER,
        );
        if (!cancelled && usdc) setLiveBaseBalance(parseFloat(usdc.balance));
      } catch (e) { console.warn("[DepositModal] Horizon balance failed", e); }
    })();
    return () => { cancelled = true; };
  }, [isOpen, publicKey]);

  const fetchInstructions = useCallback(async () => {
    if (!companyId || !publicKey || !signMessage) return;
    try {
      const res = await walletAuthenticatedFetch({
        wallet: publicKey,
        signMessage,
        path: `/api/v1/companies/${companyId}/funding-instructions?wallet=${publicKey}`,
      });
      if (res.ok) setInstructions(await res.json());
    } catch (e) { console.warn("funding-instructions failed", e); }
  }, [companyId, publicKey, signMessage]);

  const fetchBalance = useCallback(async () => {
    if (!companyId || !publicKey || !signMessage) return;
    try {
      const res = await walletAuthenticatedFetch({
        wallet: publicKey,
        signMessage,
        path: `/api/v1/companies/${companyId}/balance?wallet=${publicKey}`,
      });
      if (res.ok) {
        const data = await res.json();
        setTreasuryBalance(data.balance);
      }
    } catch (e) { console.warn("balance failed", e); }
  }, [companyId, publicKey, signMessage]);

  useEffect(() => {
    if (!isOpen) return;
    setSuccessSig(null); setDepositedAmount(null); setAmount("");
    if (companyId) { void fetchInstructions(); void fetchBalance(); }
  }, [isOpen, companyId, fetchInstructions, fetchBalance]);

  if (!isOpen) return null;

  const handleClose = () => { setSuccessSig(null); setDepositedAmount(null); setAmount(""); onClose(); };

  const treasury = instructions?.treasuryPubkey || treasuryPubkey || "";
  const xlmStep = instructions?.steps.find(s => s.step === 1);
  const trustlineStep = instructions?.steps.find(s => s.step === 2);
  const usdcStep = instructions?.steps.find(s => s.step === 3);
  const hasXlm = xlmStep?.status === "completed";
  const hasTrustline = trustlineStep?.status === "completed";
  const treasuryReady = hasXlm && hasTrustline;
  const displayTreasuryXlm = treasuryBalance?.xlm ?? xlmStep?.xlmBalance ?? "0";
  const displayTreasuryUsdc = treasuryBalance?.usdc ?? usdcStep?.usdcBalance ?? privateBalance.toString();

  const buildPaymentXdr = async (destination: string, asset: StellarSdk.Asset, amt: string) => {
    if (!publicKey) throw new Error("Wallet not connected");
    const { HORIZON_URL } = await import("@/lib/wallet/contract-config");
    const { getStellarNetworkPassphrase } = await import("@/lib/wallet/stellar-wallet");
    const Horizon = StellarSdk.Horizon;
    const server = new Horizon.Server(HORIZON_URL);
    const source = await server.loadAccount(publicKey);
    const networkPassphrase = await getStellarNetworkPassphrase();
    const isNative = asset.isNative();
    // Treasury is a fresh random keypair — account doesn't exist yet. Must use createAccount, not payment, for initial XLM.
    let op: StellarSdk.Operation;
    if (isNative) {
      try {
        await server.loadAccount(destination);
        op = StellarSdk.Operation.payment({ destination, asset, amount: amt });
      } catch {
        op = StellarSdk.Operation.createAccount({ destination, startingBalance: amt });
      }
    } else {
      op = StellarSdk.Operation.payment({ destination, asset, amount: amt });
    }
    const tx = new StellarSdk.TransactionBuilder(source, { fee: StellarSdk.BASE_FEE, networkPassphrase })
      .addOperation(op as any)
      .setTimeout(120)
      .build();
    return { xdr: tx.toXDR(), networkPassphrase };
  };

  const submitViaFreighter = async (xdr: string) => {
    if (!signTransaction) throw new Error("Freighter not connected");
    const signedXdr = await signTransaction(xdr);
    const { HORIZON_URL } = await import("@/lib/wallet/contract-config");
    const { STELLAR_NETWORK_PASSPHRASE } = await import("@/lib/wallet/contract-config");
    const { getStellarNetworkPassphrase } = await import("@/lib/wallet/stellar-wallet");
    const networkPassphrase = await getStellarNetworkPassphrase().catch(() => STELLAR_NETWORK_PASSPHRASE);
    const server = new StellarSdk.Horizon.Server(HORIZON_URL);
    const tx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase) as StellarSdk.Transaction;
    try {
      const res: any = await server.submitTransaction(tx as any);
      return res.hash as string;
    } catch (e: any) {
      // Horizon returns 400 with rich error in response.data.extras
      const data = e?.response?.data || e?.data || {};
      const codes = data?.extras?.result_codes ? JSON.stringify(data.extras.result_codes) : "";
      const detail = data?.extras?.result_codes?.operations?.join(",") || data?.detail || e?.message || "Unknown";
      console.error("[submit] Horizon 400", data);
      throw new Error(`${data.title || "Transaction failed"}: ${detail} ${codes}`.trim());
    }
  };

  const handleSendXlm = async () => {
    if (!treasury) return toast.error("Treasury not ready");
    setLoading("xlm");
    try {
      toast.info("Building 2 XLM payment… 2 XLM is required to create the treasury wallet (1 XLM base reserve + trustline + fees).");
      const { xdr } = await buildPaymentXdr(treasury, StellarSdk.Asset.native(), "2");
      toast.info("Sign 2 XLM transfer in Freighter…");
      const hash = await submitViaFreighter(xdr);
      toast.success("2 XLM sent — treasury funded");
      setSuccessSig(hash);
      await fetchInstructions(); await fetchBalance();
      onDepositSuccess?.();
    } catch (e: any) { toast.error(e.message || "XLM transfer failed"); } finally { setLoading(null); }
  };

  const handleSetupTrustline = async () => {
    if (!companyId || !publicKey || !signMessage) return;
    setLoading("trustline");
    try {
      toast.info("Requesting backend to add USDC trustline…");
      const res = await walletAuthenticatedFetch({
        wallet: publicKey,
        signMessage,
        path: `/api/v1/companies/${companyId}/setup-trustline?wallet=${publicKey}`,
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Trustline failed");
      toast.success(`Trustline added: ${data.txHash?.slice(0, 8)}…`);
      await fetchInstructions(); await fetchBalance();
      onDepositSuccess?.();
    } catch (e: any) { toast.error(e.message || "Trustline failed"); } finally { setLoading(null); }
  };

  const handleSendUsdc = async () => {
    if (!treasury) return toast.error("Treasury not ready");
    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) return toast.error("Enter a valid amount");
    if (val > liveBaseBalance) return toast.error("Insufficient USDC balance");
    setLoading("usdc");
    try {
      const { USDC_ISSUER } = await import("@/lib/wallet/contract-config");
      const usdcAsset = new StellarSdk.Asset("USDC", USDC_ISSUER);
      toast.info(`Building ${val} USDC payment…`);
      const { xdr } = await buildPaymentXdr(treasury, usdcAsset, val.toFixed(7));
      toast.info("Sign USDC transfer in Freighter…");
      const hash = await submitViaFreighter(xdr);
      toast.success(`Sent ${val} USDC to treasury`);
      // Persist to verified history so Total Deposited / graphs update — backend expects {wallet, kind, data}
      try {
        const histRes = await walletAuthenticatedFetch({
          wallet: publicKey!,
          signMessage: signMessage!,
          path: `/api/v1/history?wallet=${publicKey}`,
          method: "POST",
          body: { wallet: publicKey, kind: "setup-action", data: { type: "fund-treasury", amount: val, txSig: hash, status: "success" } },
        });
        if (!histRes.ok) console.warn("history save non-ok", await histRes.text().catch(() => ""));
      } catch (e) { console.warn("history save failed", e); }
      setDepositedAmount(val); setSuccessSig(hash);
      setAmount("");
      await fetchInstructions(); await fetchBalance();
      onDepositSuccess?.();
    } catch (e: any) { toast.error(e.message || "USDC transfer failed"); } finally { setLoading(null); }
  };

  const copy = (v: string) => { navigator.clipboard.writeText(v); toast.success("Copied"); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg rounded-[2.5rem] border border-white/10 bg-[#0a0a0a] p-8 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <button onClick={handleClose} className="absolute right-6 top-6 rounded-xl p-2 text-[#a8a8aa] hover:bg-white/5 hover:text-white"><X size={18} /></button>

        {successSig && depositedAmount !== null ? (
          <>
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10"><CheckCircle2 size={28} className="text-emerald-400" /></div>
            <h2 className="mb-1 text-2xl font-bold text-white">Deposit Complete</h2>
            <p className="mb-6 text-sm text-[#a8a8aa]">Funds deposited to payroll treasury.</p>
            <div className="mb-6 rounded-2xl border border-white/5 bg-white/5 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#a8a8aa]">Amount</p>
              <p className="text-xl font-bold text-white">{depositedAmount.toFixed(2)} <span className="text-sm text-emerald-400">USDC</span></p>
            </div>
            <a href={`https://stellarchain.io/transactions/${successSig}`} target="_blank" rel="noopener noreferrer" className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-[#111111] px-4 py-3 hover:border-white/10">
              <span className="font-mono text-xs text-[#a8a8aa]">View on Stellar Chain</span><span className="font-mono text-xs text-[#a855f7] flex items-center gap-1">{successSig.slice(0, 8)}…<ExternalLink size={11} /></span>
            </a>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button onClick={handleClose} className="rounded-2xl border border-white/10 bg-[#111111] py-4 text-sm font-bold text-white">Close</button>
              <Link href="/people" onClick={handleClose} className="rounded-2xl bg-white py-4 text-center text-sm font-bold text-black">Go to Teammates</Link>
            </div>
          </>
        ) : (
          <>
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 mx-auto"><Wallet size={28} className="text-white" /></div>
            <div className="flex justify-center mb-4"><div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#111111] px-3 py-1.5"><ShieldCheck size={14} className="text-[#a855f7]" /><span className="text-[10px] font-bold uppercase tracking-widest text-[#a855f7]">Stellar Testnet</span></div></div>
            <h2 className="mb-1 text-center text-2xl font-bold text-white flex items-center justify-center gap-2"><img src="/usdc-logo.png" alt="USDC" className="w-6 h-6" />Deposit to Treasury</h2>
            <p className="mb-4 text-center text-sm text-[#a8a8aa]">Fund the on-chain treasury to run payroll. Follow the steps below.</p>

            {/* 2 XLM warning — hide once treasury is funded + trustline ready */}
            {!treasuryReady && (
              <div className="mb-6 flex gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <AlertCircle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-300">2 XLM required to activate treasury</p>
                  <p className="text-xs text-amber-200/80 mt-1">Stellar requires ~2 XLM base reserve to create the treasury wallet and add a USDC trustline. This is a one-time on-chain cost.</p>
                </div>
              </div>
            )}
            {treasuryReady && (
              <div className="mb-6 flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
                <CheckCircle2 size={14} className="text-emerald-400" />
                <p className="text-xs font-bold text-emerald-300">Treasury activated — {displayTreasuryXlm} XLM • trustline ready</p>
              </div>
            )}

            {/* Treasury pubkey */}
            {treasury && (
              <div className="mb-6 rounded-2xl border border-white/5 bg-white/5 p-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#a8a8aa] mb-1">Treasury Address</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-xs text-white truncate">{treasury.slice(0, 8)}…{treasury.slice(-8)}</p>
                  <button onClick={() => copy(treasury)} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20"><Copy size={12} className="text-white" /></button>
                </div>
              </div>
            )}

            <div className="mb-6 grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-white/5 bg-white/5 p-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-[#a8a8aa]">Your USDC</p>
                <p className="text-sm font-bold text-white">{liveBaseBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[10px] text-[#a8a8aa]">USDC</span></p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/5 p-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-[#a8a8aa]">Treasury XLM</p>
                <p className="text-sm font-bold text-white">{parseFloat(displayTreasuryXlm).toFixed(2)} <span className="text-[10px] text-[#a8a8aa]">XLM</span> {treasuryBalance?.hasTrustline === false && <span className="text-[9px] text-amber-400">no trustline</span>}</p>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/5 p-3">
                <p className="text-[9px] font-bold uppercase tracking-widest text-[#a8a8aa]">Treasury USDC</p>
                <p className="text-sm font-bold text-white">{parseFloat(displayTreasuryUsdc || "0").toFixed(2)} <span className="text-[10px] text-[#a8a8aa]">USDC</span></p>
              </div>
            </div>

            {/* Steps */}
            <div className="mb-6 space-y-3">
              {!treasuryReady ? (
                <>
                  {/* Step 1 XLM */}
                  <div className={`rounded-2xl border p-4 ${hasXlm ? "border-emerald-500/20 bg-emerald-500/5" : "border-white/10 bg-[#111111]"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${hasXlm ? "bg-emerald-500 text-black" : "bg-white/10 text-white"}`}>{hasXlm ? "✓" : "1"}</div>
                        <div>
                          <p className="text-sm font-bold text-white">Fund 2 XLM reserve</p>
                          <p className="text-xs text-[#a8a8aa]">{hasXlm ? `Completed • ${displayTreasuryXlm} XLM` : "One-time • creates treasury wallet"}</p>
                        </div>
                      </div>
                      {!hasXlm && (
                        <button onClick={handleSendXlm} disabled={loading === "xlm"} className="inline-flex items-center gap-1.5 rounded-xl bg-[#a855f7] px-4 py-2 text-xs font-bold text-black disabled:opacity-40">
                          {loading === "xlm" ? <Loader2 size={14} className="animate-spin" /> : <Coins size={14} />}Send 2 XLM
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Step 2 Trustline */}
                  <div className={`rounded-2xl border p-4 ${hasTrustline ? "border-emerald-500/20 bg-emerald-500/5" : trustlineStep?.status === "blocked" ? "border-white/5 bg-white/[0.02] opacity-60" : "border-white/10 bg-[#111111]"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${hasTrustline ? "bg-emerald-500 text-black" : trustlineStep?.status === "blocked" ? "bg-white/5 text-[#a8a8aa]" : "bg-white/10 text-white"}`}>{hasTrustline ? "✓" : "2"}</div>
                        <div>
                          <p className="text-sm font-bold text-white">Setup USDC trustline</p>
                          <p className="text-xs text-[#a8a8aa]">{hasTrustline ? "Completed" : trustlineStep?.status === "blocked" ? "Needs 2 XLM first" : "Backend adds trustline"}</p>
                        </div>
                      </div>
                      {!hasTrustline && trustlineStep?.status === "ready" && (
                        <button onClick={handleSetupTrustline} disabled={loading === "trustline"} className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-black disabled:opacity-40">
                          {loading === "trustline" ? <Loader2 size={14} className="animate-spin inline mr-1" /> : null}Setup
                        </button>
                      )}
                    </div>
                  </div>
                </>
              ) : null}

              {/* Step 3 USDC — always when treasuryReady, else gated */}
              <div className={`rounded-2xl border p-4 ${treasuryReady ? "border-white/10 bg-[#111111]" : usdcStep?.status === "blocked" ? "border-white/5 bg-white/[0.02] opacity-60" : "border-white/10 bg-[#111111]"}`}>
                {!treasuryReady && (
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold bg-white/5 text-[#a8a8aa]">3</div>
                    <div>
                      <p className="text-sm font-bold text-white">Fund USDC for payroll</p>
                      <p className="text-xs text-[#a8a8aa]">Needs trustline</p>
                    </div>
                  </div>
                )}
                {treasuryReady && (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-[#a8a8aa]">Amount (USDC)</label>
                      <button onClick={() => setAmount(liveBaseBalance.toString())} className="text-[10px] font-bold uppercase tracking-widest text-[#a855f7]">Max</button>
                    </div>
                    <div className="flex gap-2">
                      <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="flex-1 rounded-2xl border border-white/10 bg-[#0a0a0a] px-4 py-3 font-mono text-white outline-none focus:border-[#a855f7]/50" min={0} step={0.01} max={liveBaseBalance} />
                      <button onClick={handleSendUsdc} disabled={loading === "usdc" || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > liveBaseBalance} className="rounded-2xl bg-[#a855f7] px-6 py-3 text-sm font-bold text-black disabled:opacity-40 inline-flex items-center gap-2">
                        {loading === "usdc" ? <Loader2 size={16} className="animate-spin" /> : null}Send
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

          </>
        )}
      </div>
    </div>
  );
}
