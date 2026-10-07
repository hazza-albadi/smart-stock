import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import en from "../locales/en.json";
import ar from "../locales/ar.json";

const E = en as Record<string, string>, A = ar as Record<string, string>;
const files = fs.readdirSync("components").filter((f) => f.endsWith(".tsx")).map((f) => path.join("components", f));

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
