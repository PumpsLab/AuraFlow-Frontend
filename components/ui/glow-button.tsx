import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface GlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  href?: string;
  children: React.ReactNode;
  lightColor?: string;
  glowColor?: string;
  className?: string;
}

export function GlowButton({
  href,
  children,
  lightColor = "#faf8f5",
  glowColor = "rgba(250, 248, 245, 0.5)",
  className,
  ...props
}: GlowButtonProps) {
  const innerContent = (
    <>
      <span
        className="absolute inset-0 rounded-[26px] p-[2px] z-0 pointer-events-none"
        style={{
          mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          maskComposite: "exclude",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
        }}
      >
        <span
          className="border-glow absolute top-1/2 left-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            "--glow-half-spread": "10",
            "--light-color": lightColor,
            "--glow-color": glowColor,
          } as React.CSSProperties}
        />
      </span>
      <span className="absolute inset-0 rounded-[26px] border-2 border-solid border-[rgba(250,248,245,0.1)] pointer-events-none" />
      <span className="relative z-10 flex items-center tracking-[0.72px] w-full justify-between gap-2">
        {children}
      </span>
    </>
  );

  const buttonClasses = cn(
    "group relative cursor-pointer items-center justify-center overflow-hidden rounded-[26px] px-[30px] py-[14px] font-[430] text-[#faf8f5] no-underline transition-all flex",
    className
  );

  if (href) {
    return (
      <Link href={href} className={buttonClasses}>
        {innerContent}
      </Link>
    );
  }

  return (
    <button className={buttonClasses} {...props}>
      {innerContent}
    </button>
  );
}
