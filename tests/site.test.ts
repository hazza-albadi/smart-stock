import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { gate, SESSION_COOKIE } from "../lib/gate";
import { middleware } from "../middleware";
import { POST as trialPost } from "../app/api/trial/route";
import { POST as signinPost } from "../app/api/signin/route";
import { POST as signoutPost } from "../app/api/signout/route";
import { GET as spacesGet } from "../app/api/public-spaces/route";
import LoginForm from "../components/site/LoginForm";
import SiteHeader from "../components/site/SiteHeader";
import { useDatabase, db, closeDb } from "../lib/db";
import { seedDatabase } from "../lib/seed";
import { runAll } from "../lib/agents/coordinator";
import { setSetting } from "../lib/settings";
import { publicSpaces } from "../lib/publicSpaces";
import { listWindow } from "../lib/space/actions";
import { snapshot } from "../lib/snapshot";
import en from "../locales/en.json";
import ar from "../locales/ar.json";

(globalThis as unknown as { React: typeof React }).React = React; // tsx compiles JSX with the classic runtime here
const E = en as Record<string, string>, A = ar as Record<string, string>;
const file = path.join(os.tmpdir(), `smartstock-site-${process.pid}.db`);
before(() => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); useDatabase(file); });
test.after(() => { closeDb(); for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); });
const req = (p: string, cookie?: string) => new NextRequest(`http://localhost:3000${p}`, cookie ? { headers: { cookie } } : undefined);
const read = (f: string) => fs.readFileSync(f, "utf8");

// ------------------------------------------------------------------ access rules
test("gate: the website and the public routes are open; the workspace and its API need the trial cookie", () => {
  for (const p of ["/", "/spaces", "/login", "/api/public-spaces", "/api/trial", "/api/signin", "/api/signout", "/spaces/"]) assert.equal(gate(p, undefined).action, "allow", p);
  for (const p of ["/simulation", "/simulation/", "/simulation/x"]) assert.deepEqual(gate(p, undefined), { action: "redirect", to: "/login" }, p);
  for (const p of ["/api/state", "/api/sim", "/api/agents", "/api/drafts", "/api/recommendations/1", "/api/space/offers/1", "/api/impact"]) assert.equal(gate(p, undefined).action, "deny", p);
  assert.equal(gate("/simulation", "other").action, "redirect");
  assert.equal(gate("/simulation", "trial").action, "allow");
  assert.equal(gate("/api/state", "trial").action, "allow");
});

test("middleware: /simulation is blocked without the cookie and allowed with the trial cookie; /, /spaces and /login are public", async () => {
  const blocked = middleware(req("/simulation"));
  assert.equal(blocked.status, 307);
  assert.equal(new URL(blocked.headers.get("location")!).pathname, "/login");
  assert.equal(middleware(req("/simulation", "ss_session=nope")).status, 307);
  assert.equal(middleware(req("/simulation", "ss_session=trial")).headers.get("x-middleware-next"), "1");
  for (const p of ["/", "/spaces", "/login", "/api/public-spaces"]) assert.equal(middleware(req(p)).headers.get("x-middleware-next"), "1", p);
  assert.equal(middleware(req("/api/state")).status, 401);
  assert.equal(middleware(req("/api/state", "ss_session=trial")).headers.get("x-middleware-next"), "1");
  assert.match(read("middleware.ts"), /matcher/);
});

test("trial sign-in sets the demo cookie and opens /simulation; sign-out clears it", async () => {
  const r = await trialPost(new Request("http://localhost:3000/api/trial", { method: "POST" }));
  assert.equal(r.status, 303);
  assert.equal(new URL(r.headers.get("location")!).pathname, "/simulation");
  const c = r.cookies.get(SESSION_COOKIE)!;
  assert.equal(c.value, "trial"); assert.equal(c.httpOnly, true); assert.equal(c.sameSite, "lax"); assert.equal(c.path, "/");
  const o = await signoutPost(new Request("http://localhost:3000/api/signout", { method: "POST" }));
  assert.equal(new URL(o.headers.get("location")!).pathname, "/");
  assert.equal(o.cookies.get(SESSION_COOKIE)!.value, ""); assert.equal(o.cookies.get(SESSION_COOKIE)!.maxAge, 0);
});

// ------------------------------------------------------------------ the sign-in page
test("login: normal sign-in form plus a separate trial button; no sign-up, no registration, no forgot-password", () => {
  const html = renderToStaticMarkup(createElement(LoginForm, {}));
  assert.match(html, /type="email"/); assert.match(html, /type="password"/);
  assert.ok(html.includes(A["site.login.submit"]) && html.includes(A["site.login.trial"]));
  assert.match(html, /action="\/api\/trial"/);
  assert.ok(!/href=/.test(html), "no links at all on the sign-in card");
  const src = [read("components/site/LoginForm.tsx"), read("app/(site)/login/page.tsx"), read("components/site/SiteHeader.tsx")].join("\n");
  assert.ok(!/sign-?up|register|create.?account|forgot|signup/i.test(src), "no sign-up code");
  const words = Object.keys(A).filter((k) => k.startsWith("site.")).map((k) => A[k]).join(" ");
  assert.ok(!/(إنشاء حساب|تسجيل جديد|نسيت|سجّل الآن)/.test(words), "no sign-up or forgot-password text");
});

test("login: any sign-in shows the same error (role=alert) and never sets a cookie; the input is never read", async () => {
  assert.ok(!renderToStaticMarkup(createElement(LoginForm, {})).includes('role="alert"'), "no error before submitting");
  const withError = renderToStaticMarkup(createElement(LoginForm, { initialError: true }));
  assert.match(withError, /role="alert"/);
  assert.ok(withError.includes("البيانات المدخلة غير صحيحة"));
  const src = read("components/site/LoginForm.tsx");
  assert.match(src, /onSubmit=\{\(e\) => \{ e\.preventDefault\(\); setError\(true\); \}\}/, "the form only shows the error, whatever was typed");
  assert.ok(!/localStorage|sessionStorage|document\.cookie|console\.|fetch\(/.test(src), "nothing is stored, sent or logged");
  for (const body of ["", "email=a%40b.c&password=secret"]) {
    const r = await signinPost(new Request("http://localhost:3000/api/signin", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }));
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), "http://localhost:3000/login?error=1");
    assert.equal(r.cookies.getAll().length, 0, "no cookie");
    assert.ok(!(r.headers.get("set-cookie") ?? ""), "no set-cookie header");
  }
});

test("the header shows Sign in, or Sign out after the trial sign-in; the pages are Arabic only", () => {
  const out = renderToStaticMarkup(createElement(SiteHeader, { signedIn: false }));
  assert.ok(out.includes(A["site.nav.home"]) && out.includes(A["site.nav.spaces"]) && out.includes(A["site.nav.login"]));
  assert.ok(!out.includes(A["site.nav.logout"]));
  const inn = renderToStaticMarkup(createElement(SiteHeader, { signedIn: true }));
  assert.ok(inn.includes(A["site.nav.logout"]) && !inn.includes(`>${A["site.nav.login"]}<`));
  assert.match(inn, /action="\/api\/signout"/);
  const layout = read("app/(site)/layout.tsx");
  assert.match(layout, /dir="rtl" lang="ar"/);
  assert.match(layout, /next\/font\/local/); assert.match(layout, /thmanyahsans-Regular\.otf/);
  assert.ok(!/lang-switch|setLang|language/i.test(layout + read("components/site/SiteHeader.tsx")), "no language switcher");
  for (const w of ["Regular", "Medium", "Bold"]) assert.ok(fs.existsSync(`public/fonts/thmanyah/thmanyahsans-${w}.otf`), w);
  assert.ok(!/thmanyah/i.test(read("app/layout.tsx") + read("app/globals.css")), "the workspace font is untouched");
});

// ------------------------------------------------------------------ translations and literals
test("every key the website uses exists in Arabic (and English, so the files stay in step)", () => {
  const files = ["components/site", "app/(site)"].flatMap((d) => { const walk = (x: string): string[] => fs.readdirSync(x, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(x, e.name)) : [path.join(x, e.name)])); return walk(d); });
  const src = files.map(read).join("\n");
  const used = new Set<string>();
  for (const m of src.matchAll(/\bT\("([A-Za-z0-9_.]+)"\)/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bT\(`([A-Za-z0-9_.]+)\$\{/g)) assert.ok(Object.keys(A).some((k) => k.startsWith(m[1])), `family ${m[1]}`);
  for (const v of ["v1", "v2", "v3"]) { used.add(`site.home.${v}_title`); used.add(`site.home.${v}_text`); }
  assert.deepEqual([...used].filter((k) => !(k in A) || !A[k]), []);
  assert.deepEqual(Object.keys(E).sort(), Object.keys(A).sort());
  assert.ok(Object.keys(A).filter((k) => k.startsWith("site.")).length > 50);
});

test("no user-facing text is typed in the website files (components/site and app/(site))", () => {
  const bad: string[] = [];
  for (const f of [...fs.readdirSync("components/site").map((x) => `components/site/${x}`), "app/(site)/page.tsx", "app/(site)/layout.tsx", "app/(site)/login/page.tsx", "app/(site)/spaces/page.tsx"].filter((x) => x.endsWith(".tsx"))) {
    const src = read(f);
    for (const m of src.matchAll(/>([^<>{}=;()&|]*?[A-Za-z؀-ۿ]{2,}[^<>{}=;()&|]*?)</g)) { const t = m[1].trim(); if (t && !/^[\s·—–|/:()%+\-•…]*$/.test(t)) bad.push(`${f}: "${t.slice(0, 40)}"`); }
    for (const m of src.matchAll(/\b(?:aria-label|title|placeholder|alt)="([^"{}]*[A-Za-z؀-ۿ]{2,}[^"{}]*)"/g)) bad.push(`${f}: attribute "${m[1]}"`);
  }
  assert.deepEqual(bad, []);
});

test("the website copy never mentions the simulation, its clock or the agents", () => {
  const words = Object.keys(A).filter((k) => k.startsWith("site.")).flatMap((k) => [A[k], E[k]]).join(" ");
  assert.ok(!/(محاكاة|وكيل|وكلاء|ساعة المحاكاة|simulation|agent|tick|clock|speed)/i.test(words));
});

// ------------------------------------------------------------------ the public spaces
test("public spaces: read-only list of published, unleased listings; labelled samples only when nothing is listed", async () => {
  seedDatabase({ overrides: { "sim.auto_pause_critical": false } }); runAll({ group: "start", trigger: "start" });
  const before = JSON.stringify(db().prepare(`SELECT COUNT(*) n FROM space_listings`).get()) + JSON.stringify(db().prepare(`SELECT COUNT(*) n FROM drafts`).get());
  const samples = publicSpaces();
  assert.equal(samples.length, 3);
  assert.ok(samples.every((s) => s.sample && s.area > 0 && s.price > 0), "labelled as samples");
  const body = await (await spacesGet()).json();
  assert.equal(body.spaces.length, 3);
  setSetting("space.public_demo_samples", false);
  assert.deepEqual(publicSpaces(), [], "samples off: empty state");
  setSetting("space.public_demo_samples", true);
  const w = snapshot().space.windows.filter((x) => x.state === "NEW").sort((a, b) => b.area - a.area)[0];
  listWindow({ zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.end, price: 4.5, publish: true });
  const real = publicSpaces();
  assert.equal(real.length, 1);
  assert.equal(real[0].sample, false); assert.equal(real[0].area, w.area); assert.equal(real[0].price, 4.5); assert.equal(real[0].start, w.start);
  assert.ok(!db().prepare(`SELECT 1 FROM space_leases`).get());
  const r = await spacesGet();
  assert.equal((await r.json()).spaces.length, 1);
  // the route only reads
  assert.ok(!/INSERT|UPDATE|DELETE|DROP|CREATE/i.test(read("lib/publicSpaces.ts").replace(/\/\/.*/g, "")) && !/INSERT|UPDATE|DELETE/.test(read("app/api/public-spaces/route.ts")));
  assert.equal(before.length > 0, true);
});
