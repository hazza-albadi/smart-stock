"use client";
import { render } from "@/lib/render";
import { useApp } from "./ctx";
import { useSnap } from "@/lib/store";

const NL = String.fromCharCode(10, 10);

/** The text of a message (supplier message or draft) in one language: the manager's edited text when there is one, else the rendered message. */
export function messageText(l: "ar" | "en", payload: any, items: Record<string, { name_en: string; name_ar: string }>): string {
  return payload.body_override ? payload.body_override[l] : [render(l, payload.subject, { items }), ...payload.parts.map((m: any) => render(l, m, { items }))].join(NL);
}

/** The message in both languages, each rendered in its own language so both drafts are always ready to send. */
export default function SupplierMessage({ payload }: { payload: any }) {
  const { lang } = useApp();
  const names = useSnap((s) => s.names);
  const order = lang === "ar" ? (["ar", "en"] as const) : (["en", "ar"] as const);
  return (
    <div className="mt-2 grid gap-2 md:grid-cols-2">
      {order.map((l) => (
        <pre key={l} dir={l === "ar" ? "rtl" : "ltr"} lang={l} className="whitespace-pre-wrap rounded-lg border border-line bg-surface p-2.5 font-[inherit] text-sm leading-relaxed">{messageText(l, payload, names)}</pre>
      ))}
    </div>
  );
}
