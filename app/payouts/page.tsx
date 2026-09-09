import Link from "next/link";
import { ArrowRight, Play, Users, FileSpreadsheet } from "lucide-react";
import { EmployerLayout } from "@/components/employer-layout";

export default function PayoutsPage() {
  return (
    <EmployerLayout>
      <div className="mx-auto w-full max-w-6xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-white">Payouts</h1>
          <p className="text-sm text-[#a8a8aa]">
            Choose a payout mode. Single payout supports both private transfer and realtime private stream.
          </p>
        </div>

        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          <section className="flex h-full min-h-[300px] flex-col rounded-3xl border border-white/10 bg-[#0b0f14] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-[#a855f7]/30 bg-[#a855f7]/10">
              <Play size={20} className="text-[#a855f7]" />
            </div>
            <h2 className="text-2xl font-bold text-white">Single Payout</h2>
            <p className="mt-2 text-sm text-[#a8a8aa]">
              Run payroll for one employee at a time.
            </p>
            <div className="mt-4 space-y-2 text-sm text-[#d4d4d8]">
              <p>Best for bonuses, corrections, and one-off salary actions.</p>
              <p>Keeps compensation and treasury flow private end-to-end.</p>
            </div>
            <div className="mt-auto grid gap-3 pt-6 sm:grid-cols-2">
              <Link
                href="/payouts/single?mode=private"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#a855f7] px-4 py-3 text-sm font-bold text-black transition-colors hover:bg-[#a855f7]/85"
              >
                Private Transfer
                <ArrowRight size={16} />
              </Link>
              <Link
                href="/payouts/single?mode=stream"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#a855f7]/50 bg-transparent px-4 py-3 text-sm font-bold text-[#a855f7] transition-colors hover:bg-[#a855f7]/10"
              >
                Realtime Stream
                <ArrowRight size={16} />
              </Link>
            </div>
          </section>

          <section className="flex h-full min-h-[300px] flex-col rounded-3xl border border-white/10 bg-[#0b0f14] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
              <FileSpreadsheet size={20} className="text-[#a8a8aa]" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold text-white">Batch Payout</h2>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#b8b8bd]">
                Coming Soon
              </span>
            </div>
            <p className="mt-2 text-sm text-[#a8a8aa]">
              Multi-employee payroll will launch after the final batch flow is polished.
            </p>
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="pointer-events-none select-none blur-[1.4px] opacity-80">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm font-medium text-[#d8d8dc]">
                    Batch Transfer
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm font-medium text-[#d8d8dc]">
                    Batch Streaming
                  </span>
                </div>
                <p className="mt-3 text-xs text-[#a8a8aa]">
                  Team load, review window, and one-click multi employee execution.
                </p>
              </div>
            </div>
            <div className="mt-auto pt-6">
              <button
                type="button"
                disabled
                className="inline-flex w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-bold text-[#8f8f95]"
              >
                Batch Payout Coming Soon
              </button>
            </div>
          </section>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-[#a8a8aa]">
          Need to add or verify team members first? Go to{" "}
          <Link href="/people" className="font-semibold text-[#a855f7] hover:text-[#31d5b0]">
            Employee
          </Link>
          {" "}to manage profiles and private payout readiness.
        </div>

        <div className="grid gap-4 sm:grid-cols-1">
          <Link
            href="/people"
            className="group rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition-all hover:border-white/20 hover:bg-white/[0.04]"
          >
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
                <Users size={18} className="text-[#a8a8aa] group-hover:text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Manage Employees</p>
                <p className="text-xs text-[#8f8f95]">Edit employee profiles and statuses</p>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </EmployerLayout>
  );
}
