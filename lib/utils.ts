import { ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Validates a Stellar address format
 * Stellar addresses:
 * - Start with 'G' (public key)
 * - Are 56 characters long
 * - Use base32 encoding (A-Z, 2-7)
 */
export function isValidStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  if (address.length !== 56) return false;
  if (!address.startsWith("G")) return false;
  // Check if it only contains valid base32 characters (A-Z, 2-7)
  return /^G[A-Z2-7]{55}$/.test(address);
}
