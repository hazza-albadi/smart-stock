// Optional wording polish. All numbers/decisions come from deterministic code; the model only rewrites text.
// Without ANTHROPIC_API_KEY (or on any error) the template text is returned unchanged.
export const llmEnabled = () => !!process.env.ANTHROPIC_API_KEY;

export async function polish(en: string, ar: string): Promise<{ en: string; ar: string }> {
  if (!llmEnabled()) return { en, ar };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY as string,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.SMARTSTOCK_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 700,
        system:
          "You polish business messages for a procurement team. Keep every number, date, SKU and PO id exactly as given. " +
          "Do not add facts. Return only JSON: {\"en\": string, \"ar\": string}. Arabic must be Modern Standard Arabic, professional tone.",
        messages: [{ role: "user", content: JSON.stringify({ en, ar }) }],
      }),
    });
    clearTimeout(t);
    if (!res.ok) return { en, ar };
    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = data.content?.[0]?.text ?? "";
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (typeof json.en === "string" && typeof json.ar === "string") return { en: json.en, ar: json.ar };
  } catch {
    /* fall back to the template */
  }
  return { en, ar };
}
