// Demo gate: who may open what. This is NOT real authentication — there are no accounts; the cookie only separates the public website from the demo workspace.
export const SESSION_COOKIE = "ss_session";
export const TRIAL_VALUE = "trial";

/** Pages and routes anyone may open. Everything under /simulation and every other /api route needs the trial cookie. */
export const PUBLIC_PAGES = ["/", "/spaces", "/login"] as const;
export const PUBLIC_API = ["/api/public-spaces", "/api/trial", "/api/signin", "/api/signout"] as const;

export type Gate = { action: "allow" } | { action: "redirect"; to: string } | { action: "deny" };

export function gate(pathname: string, cookie: string | undefined): Gate {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if ((PUBLIC_PAGES as readonly string[]).includes(path) || (PUBLIC_API as readonly string[]).includes(path)) return { action: "allow" };
  const guarded = path === "/simulation" || path.startsWith("/simulation/");
  const api = path === "/api" || path.startsWith("/api/");
  if (!guarded && !api) return { action: "allow" }; // anything else is a plain 404 of the framework
  if (cookie === TRIAL_VALUE) return { action: "allow" };
  return api ? { action: "deny" } : { action: "redirect", to: "/login" };
}
