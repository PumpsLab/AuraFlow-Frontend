"use client";

import React from "react";
import Link from "next/link";
import { Logo } from "@/components/landing/Logo";

export function Footer() {
  return (
    <footer className="bg-[#000] border-t border-[rgba(250,248,245,0.1)] py-20 px-6 lg:px-12">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start gap-16">
        <div className="space-y-6 flex-1">
          <div className="flex items-center gap-3">
            <Logo className="w-8 h-8" />
            <h2 className="text-2xl font-bold tracking-tighter uppercase text-[#faf8f5]">
              AuraFlow
            </h2>
          </div>
          <p className="text-[#a8a8aa] text-[16px] font-[430] max-w-sm leading-[1.6]">
            Privacy-first real-time payroll streaming. Pay employees every second with verifiable security.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-12 md:gap-24">
          <div className="flex flex-col gap-6">
            <h4 className="text-[#faf8f5] text-[14px] font-bold tracking-wide">
              Ecosystem
            </h4>
            <div className="flex flex-col gap-4">
              <Link href="/dashboard" className="text-[#8f8f95] hover:text-[#0098F5] text-[15px] font-[430] transition-colors">
                Treasury Dashboard
              </Link>
              <Link href="/dashboard" className="text-[#8f8f95] hover:text-[#0098F5] text-[15px] font-[430] transition-colors">
                Launch App
              </Link>
              <Link href="/claim" className="text-[#8f8f95] hover:text-[#0098F5] text-[15px] font-[430] transition-colors">
                Claim Pay
              </Link>
            </div>
          </div>
          
          <div className="flex flex-col gap-6">
            <h4 className="text-[#faf8f5] text-[14px] font-bold tracking-wide">
              Resources
            </h4>
            <div className="flex flex-col gap-4">
              <Link href="#" className="text-[#8f8f95] hover:text-[#0098F5] text-[15px] font-[430] transition-colors">
                GitHub
              </Link>
              <Link href="#" className="text-[#8f8f95] hover:text-[#0098F5] text-[15px] font-[430] transition-colors">
                Documentation
              </Link>
              <Link href="#" className="text-[#8f8f95] hover:text-[#0098F5] text-[15px] font-[430] transition-colors">
                Twitter
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mt-24 flex flex-col sm:flex-row justify-between items-center gap-6 text-[14px] text-[#8f8f95] font-[430]">
        <p>© {new Date().getFullYear()} AuraFlow Labs. All rights reserved.</p>
        <p>The future of payroll is real-time.</p>
      </div>
    </footer>
  );
}
