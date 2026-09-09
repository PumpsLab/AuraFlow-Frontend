"use client";

import React from "react";
import Image from "next/image";
import { GlowButton } from "@/components/ui/glow-button";

export function Hero() {
  return (
    <section className="relative flex flex-col items-center justify-center min-h-[90vh] px-6 lg:px-12 text-center overflow-hidden z-10 pt-20">
      {/* Background radial gradient to give a slight depth (Walrus style) */}
      <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-[#6800FF]/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-8">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0098F5] opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#0098F5]"></span>
        </span>
        <span className="text-sm text-[#faf8f5] font-medium tracking-wide">Live on Stellar Testnet</span>
      </div>

      <h1 className="text-[56px] md:text-[88px] font-bold tracking-tighter leading-[1.05] text-[#faf8f5] max-w-5xl">
        Verifiable Payment
        <br />
        <span className="text-transparent bg-clip-text" style={{ backgroundImage: "linear-gradient(90deg, #faf8f5 0%, #a8a8aa 100%)" }}>
          for the Next Generation.
        </span>
      </h1>

      <p className="mt-8 text-[20px] md:text-[24px] text-[#a8a8aa] max-w-3xl leading-[1.4] font-[430]">
        Per-second salary streaming with complete auditability for organizations and complete privacy for teams on Stellar.
      </p>

      <div className="mt-12 flex flex-col sm:flex-row items-center gap-6 w-full max-w-md justify-center">
        <GlowButton href="/dashboard" className="w-full sm:w-auto text-[18px]">
          Launch App
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 13" fill="none" className="h-[16px] w-[14px] shrink-0 ml-2">
            <path d="M11.52 5.66L5.86 0L5.16 0.71L10.31 5.86H0V6.86H10.31L5.16 12.02L5.86 12.73L11.52 7.07L12.23 6.36L11.52 5.66Z" fill="currentColor" />
          </svg>
        </GlowButton>
        <a href="/claim" className="text-[#faf8f5] font-[430] text-[18px] hover:text-[#0098F5] transition-colors underline underline-offset-8 decoration-transparent hover:decoration-current">
          Claim Salary
        </a>
      </div>

      <div className="mt-24 relative w-full max-w-[800px] z-20">
        <Image
          src="/phone-screenshot-v2.png"
          alt="AuraFlow App"
          width={632}
          height={1048}
          className="w-full h-auto object-contain mx-auto border-[4px] border-[#111] rounded-[48px] shadow-[0_0_100px_rgba(104,0,255,0.15)]"
          priority
        />
      </div>
    </section>
  );
}
