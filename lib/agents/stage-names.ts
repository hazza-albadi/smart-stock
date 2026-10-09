// The four stages every agent logs (pure data, also used by the browser).
export const STAGES = ["READ", "REASON", "ACT", "VERIFY"] as const;
export type Stage = (typeof STAGES)[number];
