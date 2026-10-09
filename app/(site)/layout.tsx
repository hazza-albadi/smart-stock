import localFont from "next/font/local";
import { cookies } from "next/headers";
import SiteHeader from "@/components/site/SiteHeader";
import { T } from "@/components/site/T";
import { SESSION_COOKIE, TRIAL_VALUE } from "@/lib/gate";

// Thmanyah Sans (installed on the machine, copied to public/fonts/thmanyah): only for the website pages; the workspace keeps its own font.
const thmanyah = localFont({
  src: [
    { path: "../../public/fonts/thmanyah/thmanyahsans-Regular.otf", weight: "400", style: "normal" },
    { path: "../../public/fonts/thmanyah/thmanyahsans-Medium.otf", weight: "500", style: "normal" },
    { path: "../../public/fonts/thmanyah/thmanyahsans-Bold.otf", weight: "700", style: "normal" },
  ],
  display: "swap",
  fallback: ["Tahoma", "sans-serif"],
});

export const metadata = { title: "SmartStock", description: "مساحات تخزين للإيجار ومتابعة المخزون" };

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const signedIn = (await cookies()).get(SESSION_COOKIE)?.value === TRIAL_VALUE;
  return (
    <div dir="rtl" lang="ar" className={`${thmanyah.className} flex min-h-screen flex-col bg-bg text-ink`}>
      <SiteHeader signedIn={signedIn} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t border-line bg-surface py-5 text-center text-sm text-muted">{T("site.footer")}</footer>
    </div>
  );
}
