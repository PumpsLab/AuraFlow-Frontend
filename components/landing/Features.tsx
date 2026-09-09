"use client";

import React from "react";
import { Shield, EyeOff, Zap, Coins } from "lucide-react";

const features = [
  {
    title: "Verifiable Private Payroll",
    desc: "Salary amounts, balances, and flows are protected by a secure TEE enclave and completely hidden from on-chain explorers. You can verify the payroll engine without revealing the data.",
    icon: Shield,
  },
  {
    title: "Per-Second Streaming",
    desc: "Employees earn their salary in real-time. No more bi-weekly wait times. They can claim accrued balances instantly, whenever they want.",
    icon: Zap,
  },
  {
    title: "Zero-Knowledge Settlements",
    desc: "All on-chain settlements occur as opaque transfers. Employer and employee balances update invisibly, preventing public tracking of corporate burn rates.",
    icon: EyeOff,
  },
  {
    title: "Full Employer Control",
    desc: "Easily spin up new streams, pause active payrolls, and update rates on the fly directly from the employer dashboard. Full control without compromising privacy.",
    icon: Coins,
  },
];

export function Features() {
  return (
    <section id="features" className="py-32 px-6 lg:px-12 bg-[#000] border-t border-white/5 relative">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-20">
          <h2 className="text-[40px] md:text-[56px] font-bold tracking-tighter leading-[1.1] text-[#faf8f5] max-w-3xl mx-auto">
            The power of real-time, <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text" style={{ backgroundImage: "linear-gradient(90deg, #0098F5 0%, #6800FF 100%)" }}>
              verifiable private payroll.
            </span>
          </h2>
          <p className="mt-6 text-[#a8a8aa] text-[20px] max-w-2xl mx-auto font-[430] leading-[1.5]">
            AuraFlow combines the speed of streaming money with the security of Trusted Execution Environments (TEEs) to protect your team's financial privacy.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
          {features.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <div
                key={i}
                className="group rounded-[32px] p-8 md:p-10 border border-[rgba(250,248,245,0.1)] bg-[#0a0a0a] hover:bg-[#111111] transition-colors duration-300"
              >
                <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-6 text-[#faf8f5]">
                  <Icon strokeWidth={2} size={20} />
                </div>
                <h3 className="text-[24px] font-bold tracking-tight text-[#faf8f5] mb-4">
                  {feature.title}
                </h3>
                <p className="text-[#8f8f95] text-[16px] leading-[1.6] font-[430]">
                  {feature.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
