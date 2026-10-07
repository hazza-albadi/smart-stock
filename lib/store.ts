"use client";
import { useSyncExternalStore } from "react";
import type { Snapshot } from "./snapshot";

type Any = any;

/** Structural sharing: unchanged parts of a new snapshot keep their old identity, so only panels whose data really changed re-render. */
export function share(a: Any, b: Any): Any {
  if (a === b) return a;
  if (Array.isArray(a) && Array.isArray(b)) {
    const out = b.map((x, i) => (i < a.length ? share(a[i], x) : x));
    return out.length === a.length && out.every((x, i) => x === a[i]) ? a : out;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = Object.keys(b);
    const out: Record<string, Any> = {};
    let same = keys.length === Object.keys(a).length;
    for (const k of keys) { out[k] = k in a ? share(a[k], b[k]) : b[k]; if (out[k] !== a[k]) same = false; }
    return same ? a : out;
  }
  return b;
}

let current: Snapshot | null = null;
const listeners = new Set<() => void>();

/** Accepts a snapshot unless it is older than the one on screen (responses can arrive out of order). */
export function setSnapshot(next: Snapshot): boolean {
  if (current && next.sim.seq < current.sim.seq) return false;
  current = current ? share(current, next) : next;
  listeners.forEach((l) => l());
  return true;
}
export const getSnapshot = () => current;
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Subscribe to one slice of the snapshot. The selector must return an existing sub-object or a primitive (never build a new object). */
export function useSnap<T>(sel: (s: Snapshot) => T): T {
  const get = () => {
    if (!current) return undefined as T; // undefined until the first snapshot arrived
    const v = sel(current);
    if (process.env.NODE_ENV !== "production" && v !== sel(current)) console.error("useSnap selector returns a new value on every call:", sel.toString());
    return v;
  };
  return useSyncExternalStore(subscribe, get, get);
}
