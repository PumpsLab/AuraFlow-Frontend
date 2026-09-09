"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";

export function SiteBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if dismissed in session storage
    const dismissed = sessionStorage.getItem("site-banner-dismissed");
    if (!dismissed) {
      setIsVisible(true);
    }
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    sessionStorage.setItem("site-banner-dismissed", "true");
  };

  if (!isVisible) return null;

  return (
    <div
      className="z-[60] w-full"
      style={{
        background: "linear-gradient(90deg, #0098F5 0%, #6800FF 89.42%)",
      }}
    >
      <div className="relative hidden h-[52px] items-center justify-center gap-5 px-12 md:flex">
        <Link
          href="/pitch"
          className="text-[#faf8f5] text-[18px] font-[500] tracking-[0.01em] !underline !decoration-transparent underline-offset-4 transition-[text-decoration-color] duration-200 hover:!decoration-current"
        >
          Introducing AuraFlow: The private payroll and compliance protocol
        </Link>
        <button
          onClick={handleDismiss}
          aria-label="Close announcement banner"
          className="text-[#faf8f5] absolute top-1/2 right-4 -translate-y-1/2 cursor-pointer rounded p-1.5 transition-opacity hover:opacity-70"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div className="flex h-[52px] items-center px-4 md:hidden">
        <button
          onClick={handleDismiss}
          aria-label="Close announcement banner"
          className="text-[#faf8f5] mr-2 shrink-0 cursor-pointer rounded p-1.5 transition-opacity hover:opacity-70"
        >
          <X size={12} strokeWidth={2} />
        </button>
        <Link
          href="/pitch"
          className="text-[#faf8f5] flex-1 text-center text-[0.9375rem] leading-[1.2] font-[500] tracking-[0.01em] !underline !decoration-transparent underline-offset-8 transition-[text-decoration-color] duration-200 hover:!decoration-current"
        >
          Introducing AuraFlow: The private payroll and compliance protocol
        </Link>
      </div>
    </div>
  );
}
