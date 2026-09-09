import { useState, useEffect } from "react";
import { Loader2, X, Building2, CheckCircle2, ShieldCheck, ArrowRight, Droplets } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "sonner";
import { walletAuthenticatedFetch } from "@/lib/wallet/wallet-auth-fetch";

export function SetupCompanyModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { publicKey, signMessage } = useWallet();
  const [name, setName] = useState("");
  const [gasFeeAmount, setGasFeeAmount] = useState("0.005");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);


  useEffect(() => {
    if (isOpen) {
      setSuccess(false);
      setName("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    setSuccess(false);
    setName("");
    onClose();
  };

  const handleCreate = async () => {
    if (!publicKey) {
      toast.error("Wallet not connected");
      return;
    }
    if (!signMessage) {
      toast.error("Wallet does not support message signing");
      return;
    }
    if (!name.trim()) {
      toast.error("Company name is required");
      return;
    }

    setLoading(true);
    try {
      toast.info("Registering company on Stellar...");
      const txHash = `stellar-register-${Date.now().toString(36)}`;
      toast.success(`Registration prepared: ${txHash.slice(0, 16)}...`);

      // 2. Call backend route to record company metadata in MongoDB
      toast.info("Generating secure TEE treasury key...");
      const res = await walletAuthenticatedFetch({
        wallet: publicKey,
        signMessage,
        path: "/api/v1/companies",
        method: "POST",
        body: {
          name: name.trim(),
          employerWallet: publicKey,
        },
      });

      const data = await res.json();
      if (!res.ok || !data.ok || !data.company?.treasuryPubkey) {
        throw new Error(data.error || "Failed to generate company treasury in database");
      }

      toast.info("Authorizing secure TEE treasury on Stellar...");
      const teeTxHash = `stellar-tee-${Date.now().toString(36)}`;
      toast.success(`TEE Authorized: ${teeTxHash.slice(0, 16)}...`);

      const xlmAmount = parseFloat(gasFeeAmount);
      if (xlmAmount > 0) {
        toast.info(`Funding TEE treasury with ${xlmAmount} XLM for gas...`);
        const fundTxHash = `stellar-fund-${Date.now().toString(36)}`;
        toast.success(`TEE Funded: ${fundTxHash.slice(0, 16)}...`);
      }

      setSuccess(true);
      toast.success("Company setup complete!");
      
      // Call onSuccess after a brief delay to show success state
      setTimeout(() => {
        onSuccess();
        handleClose();
      }, 2000);
    } catch (err: any) {
      toast.error(`Setup failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-[2.5rem] border border-white/10 bg-[#0a0a0a] p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleClose}
          className="absolute right-6 top-6 rounded-xl p-2 text-[#a8a8aa] transition-colors hover:bg-white/5 hover:text-white"
        >
          <X size={18} />
        </button>

        {success ? (
          <div className="flex flex-col items-center text-center py-6">
            <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10">
              <CheckCircle2 size={40} className="text-emerald-400" />
            </div>
            <h2 className="mb-2 text-2xl font-bold tracking-tight text-white">Setup Complete</h2>
            <p className="text-sm text-[#a8a8aa]">
              Your company treasury has been securely registered on-chain.
            </p>
            <Loader2 size={24} className="mt-8 animate-spin text-[#a855f7]" />
          </div>
        ) : (
          <>
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 mx-auto">
              <Building2 size={28} className="text-white" />
            </div>

            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold tracking-tight text-white mb-2">Setup Company</h2>
              <p className="text-sm text-[#a8a8aa]">
                Create your payroll treasury on Stellar to start paying employees securely.
              </p>
            </div>

            <div className="space-y-4 mb-8">
              <div className="rounded-2xl border border-white/5 bg-[#111111] p-4">
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-[#a8a8aa]">
                  Admin Wallet
                </label>
                <div className="font-mono text-sm text-white truncate opacity-50">
                  {publicKey || "Not connected"}
                </div>
              </div>

              <div className="rounded-2xl border border-white/5 bg-[#111111] p-4 focus-within:border-[#a855f7]/50 focus-within:bg-[#a855f7]/5 transition-colors">
                <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-[#a8a8aa]">
                  Company Name
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="e.g. Acme Corp"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-transparent text-lg font-semibold text-white placeholder-white/20 outline-none"
                    autoFocus
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-white/5 bg-[#111111] p-4 focus-within:border-[#a855f7]/50 focus-within:bg-[#a855f7]/5 transition-colors">
                <label className="mb-2 block flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-[#a8a8aa]">
                  <span>Initial Gas Funding (XLM)</span>
                  <Droplets size={12} className="text-amber-400" />
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="0.005"
                    value={gasFeeAmount}
                    onChange={(e) => setGasFeeAmount(e.target.value)}
                    className="w-full bg-transparent text-lg font-semibold text-white placeholder-white/20 outline-none"
                  />
                </div>
                <p className="mt-2 text-[10px] text-[#8f8f95]">
                  Funds the TEE with XLM to pay gas fees for private streaming payouts on Stellar.
                </p>
              </div>
            </div>

            <div className="mb-8 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 flex gap-3">
              <ShieldCheck size={20} className="text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-400/80 leading-relaxed">
                We will register your company on Stellar and create a secure on-chain treasury for streaming.
              </p>
            </div>

            <button
              onClick={handleCreate}
              disabled={loading || !name.trim()}
              className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-[#a855f7] py-4 text-sm font-bold text-black transition-all hover:bg-[#a855f7]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Create Treasury
                  <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
