import Link from "next/link";
import Logo from "./Logo";
import { T } from "./T";

const link = "inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-ink hover:bg-surface2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";

/** Header of the website pages: Home, Available spaces, Sign in (Sign out once the trial cookie is set). */
export default function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <Link href="/" aria-label={T("site.brand")} className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"><Logo /></Link>
        <nav aria-label={T("site.nav.label")} className="flex flex-wrap items-center gap-1">
          <Link href="/" className={link}>{T("site.nav.home")}</Link>
          <Link href="/spaces" className={link}>{T("site.nav.spaces")}</Link>
          {signedIn && <Link href="/simulation" className={link}>{T("site.nav.workspace")}</Link>}
          {signedIn ? (
            <form action="/api/signout" method="post"><button type="submit" className={`${link} border border-line`}>{T("site.nav.logout")}</button></form>
          ) : (
            <Link href="/login" className={`${link} bg-brand text-brand-ink hover:bg-brand hover:opacity-90`}>{T("site.nav.login")}</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
