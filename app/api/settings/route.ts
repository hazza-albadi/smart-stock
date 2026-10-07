import { handle, body } from "@/lib/api";
import { loadSettings, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const GET = () => handle(() => loadSettings().all());
export async function POST(req: Request) {
  const b = await body(req);
  return handle(() => { setSetting(String(b.key), b.value); return loadSettings().all(); });
}
