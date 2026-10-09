"use client";
import { useState } from "react";
import Logo from "./Logo";
import { T } from "./T";

const field = "mt-1 block min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";

/**
 * Looks like a normal sign-in, but there are no accounts: whatever is typed (it is never read, stored or sent), the answer is the same error.
 * The only way into the workspace is the separate trial sign-in below, which needs no fields.
 */
export default function LoginForm({ initialError = false }: { initialError?: boolean }) {
  const [error, setError] = useState(initialError);
  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-sm">
      <div className="flex justify-center"><Logo size={40} /></div>
      <h1 className="mt-4 text-center text-2xl font-bold">{T("site.login.title")}</h1>
      <form method="post" action="/api/signin" noValidate onSubmit={(e) => { e.preventDefault(); setError(true); }} className="mt-5 space-y-4">
        <label className="block text-sm font-semibold">{T("site.login.email")}
          <input name="email" type="email" autoComplete="off" dir="ltr" className={field} />
        </label>
        <label className="block text-sm font-semibold">{T("site.login.password")}
          <input name="password" type="password" autoComplete="off" dir="ltr" className={field} />
        </label>
        <div aria-live="assertive">
          {error && <p role="alert" className="rounded-lg border border-crit bg-crit-soft px-3 py-2 text-sm font-semibold text-crit">{T("site.login.error")}</p>}
        </div>
        <button type="submit" className="min-h-12 w-full rounded-xl bg-brand text-base font-bold text-brand-ink hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">{T("site.login.submit")}</button>
      </form>
      <div className="my-6 flex items-center gap-3 text-sm text-muted" aria-hidden><span className="h-px flex-1 bg-line" />{T("site.login.or")}<span className="h-px flex-1 bg-line" /></div>
      <form method="post" action="/api/trial">
        <button type="submit" className="min-h-12 w-full rounded-xl border border-line bg-surface2 text-base font-bold text-ink hover:border-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">{T("site.login.trial")}</button>
        <p className="mt-2 text-center text-xs text-muted">{T("site.login.trial_note")}</p>
      </form>
    </div>
  );
}
