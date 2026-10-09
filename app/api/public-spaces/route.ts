import { NextResponse } from "next/server";
import { publicSpaces } from "@/lib/publicSpaces";

export const dynamic = "force-dynamic";

/** Public, read-only list of the spaces on offer (no login). */
export async function GET() {
  return NextResponse.json({ spaces: publicSpaces() });
}
