import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/ensure";
import { snapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  await ensureSeeded();
  return NextResponse.json(snapshot());
}
