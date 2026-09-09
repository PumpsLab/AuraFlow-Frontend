"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { GlowButton } from "@/components/ui/glow-button";
import { Logo } from "@/components/landing/Logo";

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-[background-color] duration-300 ${
        scrolled ? "bg-black/80 backdrop-blur-md border-b border-white/5" : "bg-transparent"
      }`}
    >
      <div className="relative z-50 container mx-auto flex flex-row items-center justify-between py-4 px-6 lg:px-12">
        <div className="justify-self-start">
          <Link href="/" aria-label="Home" className="inline-block transition-colors duration-300">
            <div className="flex items-center gap-3 group">
              <Logo className="w-8 h-8 group-hover:scale-110 transition-transform duration-300" />
              <span className="text-xl font-bold tracking-tighter uppercase text-[#faf8f5] hover:text-[#0098F5] transition-colors">
                Aura
                <span className="text-kast-teal">Flow</span>
              </span>
            </div>
          </Link>
        </div>

        <div className="hidden md:flex justify-self-center">
          <nav aria-label="Main navigation">
            <ul className="m-0 flex list-none items-center gap-2 p-0 xl:gap-4" role="menubar">
              <li className="nav-item relative hidden md:block">
                <Link
                  href="/#features"
                  className="flex cursor-pointer items-center gap-[10px] rounded-[26px] border border-transparent bg-transparent px-[15px] py-[10px] text-[16px] font-[430] tracking-[0.72px] text-[#faf8f5] hover:bg-white/5 transition-[background-color,border-color,color] duration-300 ease-in-out lg:px-[30px] lg:text-[18px]"
                >
                  Features
                </Link>
              </li>
              <li className="nav-item relative hidden md:block">
                <Link
                  href="/#faq"
                  className="flex cursor-pointer items-center gap-[10px] rounded-[26px] border border-transparent bg-transparent px-[15px] py-[10px] text-[16px] font-[430] tracking-[0.72px] text-[#faf8f5] hover:bg-white/5 transition-[background-color,border-color,color] duration-300 ease-in-out lg:px-[30px] lg:text-[18px]"
                >
                  FAQ
                </Link>
              </li>
              <li className="nav-item relative hidden md:block">
                <Link
                  href="/claim"
                  className="flex cursor-pointer items-center gap-[10px] rounded-[26px] border border-transparent bg-transparent px-[15px] py-[10px] text-[16px] font-[430] tracking-[0.72px] text-[#faf8f5] hover:bg-white/5 transition-[background-color,border-color,color] duration-300 ease-in-out lg:px-[30px] lg:text-[18px]"
                >
                  Claim App
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="hidden md:flex justify-self-end">
          <GlowButton href="/dashboard" className="!py-[10px] !px-[24px]">
            Launch App
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 13 13" fill="none" className="h-[14.73px] w-[12.31px] shrink-0 ml-2">
              <path d="M11.52 5.66L5.86 0L5.16 0.71L10.31 5.86H0V6.86H10.31L5.16 12.02L5.86 12.73L11.52 7.07L12.23 6.36L11.52 5.66Z" fill="currentColor" />
            </svg>
          </GlowButton>
        </div>
      </div>
    </header>
  );
}
