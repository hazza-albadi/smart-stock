export interface PoValue { quantity: number; unit_cost: number; premium?: number }
export const poValue = (p: PoValue) => p.quantity * p.unit_cost * (1 + (p.premium ?? 0));

/** committed = value of every PO ever placed in the period (open + received + approved); free = total - committed. */
export function budgetFigures(total: number, pos: PoValue[], pendingDrafts = 0) {
  const committed = pos.reduce((a, p) => a + poValue(p), 0);
  const free = total - committed;
  return { total, committed, free, afterDrafts: free - pendingDrafts, overBudget: free < -1e-9 };
}
