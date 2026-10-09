import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import en from "../locales/en.json";
import ar from "../locales/ar.json";

const E = en as Record<string, string>, A = ar as Record<string, string>;
// every component, sub-folders included (components/space, components/site)
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(d, f.name)) : f.name.endsWith(".tsx") ? [path.join(d, f.name)] : []));
const files = walk("components");

test("no user-facing text is typed in components (JSX text and text attributes go through translations)", () => {
  const bad: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    // JSX text between tags that contains letters
    for (const m of src.matchAll(/>([^<>{}=;()&|]*?[A-Za-z؀-ۿ]{2,}[^<>{}=;()&|]*?)</g)) {
      const t = m[1].trim();
      if (t && !/^[\s·—–|/:()%+\-•…✓✕✦⏸▶⏭⇥⚠↺☀☾▾▴▸►?]*$/.test(t) && !/^[a-z]+$/.test(t.replace(/\s/g, "")) && t !== "Promise") bad.push(`${f}: "${t.slice(0, 40)}"`);
    }
    for (const m of src.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"{}]*[A-Za-z؀-ۿ]{2,}[^"{}]*)"/g)) bad.push(`${f}: attribute "${m[1]}"`);
  }
  assert.deepEqual(bad, []);
});

test("every plain-language key is complete and non-empty in both languages", () => {
  for (const k of Object.keys(E)) { assert.ok(E[k].trim().length > 0, `en ${k}`); assert.ok(A[k].trim().length > 0, `ar ${k}`); }
});

test("no internal terms or raw codes in user-facing English texts", () => {
  const banned = /\b(tick|dedupe|seed|lease|anomaly|DELAYED_BY_SUPPLIER|reorder point|lead time|weeks of cover|cover)\b/i;
  const allowed = new Set(["settings.desc", "settings.sub"]);
  const bad = Object.keys(E).filter((k) => !allowed.has(k) && !k.startsWith("gl.") && banned.test(E[k].replace(/\{[^}]*\}/g, "")));
  assert.deepEqual(bad, []);
});

test("targets: body text 14px or more, controls 40px or more", () => {
  const css = fs.readFileSync("app/globals.css", "utf8");
  assert.match(css, /--text-xs: 0\.8125rem/); assert.match(css, /--text-sm: 0\.9375rem/); assert.match(css, /font-size: 15px/);
  const ui = fs.readFileSync("components/ui.tsx", "utf8");
  assert.match(ui, /min-h-10/);
});

// ---------------------------------------------------------------- colour contrast (light is the primary theme; dark must also work)
function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("contrast: text and status colours reach 4.5:1 on their backgrounds in the light AND the dark theme", () => {
  const css = fs.readFileSync("app/globals.css", "utf8");
  const light = tokens(css.slice(css.indexOf(":root {"), css.indexOf("[data-theme=\"dark\"] {")));
  const dark = tokens(css.slice(css.indexOf("[data-theme=\"dark\"] {"), css.indexOf("@theme inline")));
  for (const [name, t] of [["light", light], ["dark", dark]] as const) {
    const pairs: [string, string][] = [["ink", "surface"], ["ink", "bg"], ["muted", "surface"], ["muted", "surface2"], ["muted", "bg"], ["brand", "surface"], ["brand", "brand-soft"], ["brand-ink", "brand"],
      ["crit", "crit-soft"], ["high", "high-soft"], ["mon", "mon-soft"], ["info", "info-soft"], ["ok", "ok-soft"], ["over", "over-soft"], ["crit", "surface"], ["on-accent", "ok"], ["on-accent", "high"]];
    for (const [fg, bg] of pairs) assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${name}: ${fg} on ${bg} is ${ratio(t[fg], t[bg]).toFixed(2)}:1`);
    assert.ok(ratio(t.line, t.surface) >= 1.3, `${name}: borders must be visible`);
  }
});

test("the app opens in the light theme for every new visitor, whatever the system theme; only an explicit choice is stored (with try/catch)", () => {
  const layout = fs.readFileSync("app/layout.tsx", "utf8");
  assert.ok(!/prefers-color-scheme/.test(layout), "no system dark-mode detection");
  assert.match(layout, /data-theme="light"/);
  assert.match(layout, /t!=='dark'&&t!=='light'\)t='light'/);
  const dash = fs.readFileSync("components/Dashboard.tsx", "utf8");
  assert.match(dash, /try \{ localStorage\.setItem\("ss-theme", n\); \} catch/);
  assert.ok(!/useEffect\([^)]*ss-theme/.test(dash.replace(/\n/g, " ")), "the theme is not stored on page load");
});
