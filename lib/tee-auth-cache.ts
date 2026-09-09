// TEE (Trusted Execution Environment) auth caching for Soroban contracts
// This has been replaced with Freighter direct signing in Stellar migration

interface CachedAuthToken {
  token: string;
  expiresAt: number;
}

const authTokenCache = new Map<string, CachedAuthToken>();

export async function getOrCreateCachedTeeToken(
  publicKey: string,
  signMessage: (message: string) => Promise<string>,
): Promise<string> {
  const cached = authTokenCache.get(publicKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  // For Stellar/Soroban, we use direct wallet signing via Freighter
  // No separate TEE auth token is needed
  const signature = await signMessage(`auth-token-${Date.now()}`);
  
  const tokenData = {
    token: signature,
    expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour
  };

  authTokenCache.set(publicKey, tokenData);
  return signature;
}

export function loadCachedTeeToken(publicKey: string): string | null {
  const cached = authTokenCache.get(publicKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }
  return null;
}

export function clearCachedTeeToken(publicKey: string): void {
  authTokenCache.delete(publicKey);
}
