"use client";

import React, { useState } from "react";
import { Plus, Minus } from "lucide-react";

const faqs = [
  {
    question: "How does payroll streaming work?",
    answer:
      "Instead of paying salaries monthly, AuraFlow streams USDC to employees every single second. You deposit funds into a treasury, set per-second rates for each employee, and salaries accrue continuously. Employees can cash out anytime.",
  },
  {
    question: "How is salary data kept private on-chain?",
    answer:
      "AuraFlow uses Trusted Execution Environments (TEEs) to process payroll. The blockchain only records that a private payment occurred—never the amount, the recipient, or the employer. All sensitive data is kept completely off-chain and verifiable.",
  },
  {
    question: "Why stream payroll instead of monthly payments?",
    answer:
      "Streaming gives employees instant access to earned wages—no more waiting for payday. Employers get better cash flow management, reduced administrative overhead, and happier teams. It's payroll that moves at the speed of work.",
  },
  {
    question: "Can I pause or cancel a stream?",
    answer:
      "Yes. You have full lifecycle control over every stream. Pause, resume, adjust rates, or cancel entirely—all from a single dashboard. Changes take effect immediately.",
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="py-32 px-6 lg:px-12 bg-[#000] border-t border-[rgba(250,248,245,0.1)] relative">
      <div id="faq" className="max-w-4xl mx-auto">
        <h2 className="text-[32px] md:text-[48px] font-bold tracking-tighter text-[#faf8f5] mb-16 text-center">
          Frequently asked questions
        </h2>

        <div className="flex flex-col gap-4">
          {faqs.map((faq, index) => {
            const isOpen = openIndex === index;
            return (
              <div
                key={index}
                className="rounded-[24px] border border-[rgba(250,248,245,0.1)] bg-[#0a0a0a] overflow-hidden transition-colors hover:bg-[#111]"
              >
                <button
                  onClick={() => setOpenIndex(isOpen ? null : index)}
                  className="w-full px-8 py-6 flex items-center justify-between text-left focus:outline-none focus-visible:bg-white/5"
                >
                  <span className="text-[18px] md:text-[20px] font-bold text-[#faf8f5]">
                    {faq.question}
                  </span>
                  <div className="flex-shrink-0 ml-4 text-[#a8a8aa]">
                    {isOpen ? <Minus size={20} strokeWidth={2.5} /> : <Plus size={20} strokeWidth={2.5} />}
                  </div>
                </button>
                <div
                  className={`px-8 overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out ${
                    isOpen ? "max-h-[500px] opacity-100 pb-8" : "max-h-0 opacity-0 pb-0"
                  }`}
                >
                  <p className="text-[#8f8f95] text-[16px] leading-[1.6] font-[430]">
                    {faq.answer}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
