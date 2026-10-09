import { M, UserError } from "@/lib/core";
import { handle, body } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";
import { tick, advance, setRunning, setIntervalMs, resetSim } from "@/lib/sim";
import { setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** The server owns the clock. The browser only asks for ticks (with the hour it expects, so stale/duplicate requests are ignored). */
export async function POST(req: Request) {
  const b = await body(req);
  return handle(() => {
    let result: unknown = null;
    switch (b.action) {
      case "tick": result = tick({ expected: b.expected, auto: !!b.auto }); break;
      case "advance": setRunning(false); result = advance({ hours: b.hours, untilDay: !!b.untilDay, untilCritical: !!b.untilCritical }); break;
      case "play": setRunning(true); break;
      case "pause": setRunning(false); break;
      case "interval": setIntervalMs(Number(b.ms)); break;
      case "auto_pause": setSetting("sim.auto_pause_critical", !!b.value); break;
      case "reset": resetSim(); break;
      default: throw new UserError(M("err.bad_action"));
    }
    return { result, snapshot: snapshot() };
  });
}
