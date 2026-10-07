// "How is this calculated": formula key + the actual inputs (with units and sources) + the result.
// Labels and formulas are translation keys; numbers are raw values formatted by the UI.
export interface ExplainInput { label: string; value: number | string; unit?: string; source?: string }
export interface Explain { formula: string; inputs: ExplainInput[]; result: { value: number | string; unit?: string } }

export const ex = (formula: string, inputs: ExplainInput[], value: number | string, unit?: string): Explain => ({ formula, inputs, result: { value, unit } });
