// History queue for pending setup actions (now unused with Stellar migration)
// Kept for API compatibility

interface PendingAction {
  id: string;
  type: string;
  timestamp: number;
  wallet?: string;
}

const pendingActions: PendingAction[] = [];

export function enqueuePendingSetupAction(
  typeOrData: string | { kind?: string; type: string; wallet?: string; amount?: number; txSig?: string; status?: string },
  data?: unknown,
  wallet?: string,
): string {
  let actionType: string;
  let actionWallet: string | undefined;
  
  if (typeof typeOrData === "string") {
    actionType = typeOrData;
    actionWallet = wallet;
  } else {
    actionType = typeOrData.type;
    actionWallet = typeOrData.wallet;
  }
  
  const id = `${actionType}-${Date.now()}`;
  pendingActions.push({
    id,
    type: actionType,
    timestamp: Date.now(),
    wallet: actionWallet,
  });
  return id;
}

export async function drainPendingHistory(options?: { wallet?: string; signMessage?: (msg: string) => Promise<string> }): Promise<PendingAction[]> {
  const actions = options?.wallet 
    ? pendingActions.filter(a => a.wallet === options.wallet)
    : [...pendingActions];
  
  // Remove the drained actions from the queue
  if (options?.wallet) {
    const actionIds = new Set(actions.map(a => a.id));
    for (let i = pendingActions.length - 1; i >= 0; i--) {
      if (actionIds.has(pendingActions[i].id)) {
        pendingActions.splice(i, 1);
      }
    }
  } else {
    pendingActions.length = 0;
  }
  
  return actions;
}

export function getPendingHistoryCount(wallet?: string): number {
  if (wallet) {
    return pendingActions.filter(a => a.wallet === wallet).length;
  }
  return pendingActions.length;
}

export function clearPendingHistory(): void {
  pendingActions.length = 0;
}
