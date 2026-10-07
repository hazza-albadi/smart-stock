import { db } from "./db";
import { render } from "./render";

// Optional wording polish of supplier messages. All numbers and decisions come from deterministic code.
// Without ANTHROPIC_API_KEY (or on any error) the template text is used unchanged.
export const llmEnabled = () => !!process.env.ANTHROPIC_API_KEY;

async function polish(en: string, ar: string): Promise<{ en: string; ar: string } | null> {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY as string, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.SMARTSTOCK_MODEL || "claude-haiku-4-5-20251001", max_tokens: 900,
        system: "You polish business messages for a procurement team. Keep every number, date, item and PO id exactly as given. Do not add facts. Return only JSON with the keys en and ar.",
        messages: [{ role: "user", content: JSON.stringify({ en, ar }) }],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = data.content?.[0]?.text ?? "";
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return typeof json.en === "string" && typeof json.ar === "string" ? json : null;
  } catch {
    return null;
  }
}

/** Polishes pending supplier messages once (stored as body_override; the structured template stays the source of truth). */
export async function polishPendingMessages() {
  if (!llmEnabled()) return;
  const d = db();
  const items = Object.fromEntries((d.prepare(`SELECT item_id, name_en, name_ar FROM items`).all() as any[]).map((i) => [i.item_id, i]));
  for (const r of d.prepare(`SELECT id, payload FROM recommendations WHERE kind='SUPPLIER_MSG' AND status='PENDING'`).all() as { id: number; payload: string }[]) {
    const p = JSON.parse(r.payload);
    if (p.body_override) continue;
    const text = (l: "en" | "ar") => `${render(l, p.subject, { items })}\n\n${render(l, p.parts.map((m: any) => m), { items })}`;
    const out = await polish(text("en"), text("ar"));
    if (out) d.prepare(`UPDATE recommendations SET payload=? WHERE id=?`).run(JSON.stringify({ ...p, body_override: out }), r.id);
  }
}
