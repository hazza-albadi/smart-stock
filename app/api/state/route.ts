import { handle } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";
export const GET = () => handle(() => snapshot());
