import Link from "next/link";
import { T } from "@/components/site/T";

const VALUES = ["v1", "v2", "v3"] as const;
const cta = "inline-flex min-h-12 items-center justify-center rounded-xl px-6 text-base font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default function HomePage() {
  return (
    <>
      <section className="rounded-2xl border border-line bg-brand-soft px-6 py-12 text-center sm:py-16">
        <h1 className="mx-auto max-w-3xl text-3xl font-bold leading-snug sm:text-5xl sm:leading-tight">{T("site.home.title")}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-muted">{T("site.home.sub")}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/spaces" className={`${cta} bg-brand text-brand-ink hover:opacity-90`}>{T("site.home.cta_spaces")}</Link>
          <Link href="/login" className={`${cta} border border-line bg-surface text-ink hover:border-brand`}>{T("site.home.cta_login")}</Link>
        </div>
      </section>
      <section className="mt-10" aria-labelledby="what">
        <h2 id="what" className="text-2xl font-bold">{T("site.home.what_title")}</h2>
        <p className="mt-2 max-w-3xl text-lg leading-relaxed text-muted">{T("site.home.what_text")}</p>
        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {VALUES.map((v) => (
            <li key={v} className="rounded-xl border border-line bg-surface p-5">
              <h3 className="text-lg font-bold">{T(`site.home.${v}_title`)}</h3>
              <p className="mt-2 leading-relaxed text-muted">{T(`site.home.${v}_text`)}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
