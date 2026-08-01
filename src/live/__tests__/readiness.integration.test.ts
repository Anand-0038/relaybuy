import { expect, it } from "vitest";

import { probeConnectedReadiness } from "../readiness";

const connectedTest =
  process.env.RUN_CONNECTED_PREFLIGHT === "true" ? it : it.skip;

connectedTest(
  "verifies the real connected pre-payment provider chain",
  async () => {
    const readiness = await probeConnectedReadiness();

    console.log(JSON.stringify(readiness, null, 2));
    expect(readiness.status).toBe("ready");
  },
  90_000,
);
