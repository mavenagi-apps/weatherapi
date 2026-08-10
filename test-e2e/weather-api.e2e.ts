import nock from "nock";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import hooks from "@/index";

import { backOptions, REDACTED } from "./setup";

const RECORDING = process.env.NOCK_RECORD === "true";

const originalApiKey = process.env.WEATHER_API_KEY;

beforeAll(() => {
  // In lockdown the env var is forced to the placeholder so the replayed request path matches
  // the committed fixture. When recording, the real key from the environment is used and then
  // scrubbed back to the placeholder by `backOptions.afterRecord` in ./setup.ts, so no live
  // secret can reach a fixture file in this public repo.
  if (!RECORDING) {
    process.env.WEATHER_API_KEY = REDACTED;
  }
});

afterAll(() => {
  process.env.WEATHER_API_KEY = originalApiKey;
});

describe("WeatherAPI current.json (e2e)", () => {
  // NOTE: `weather-api-current.json` was hand-authored — a realistic-but-synthetic WeatherAPI
  // response with a redacted key in the recorded path — because no WEATHER_API_KEY was
  // available when this test was written. Re-record it against the live API with
  // `pnpm test:e2e:record` once a key is in the environment; the fixture shape stays the same.
  it("executes get_current_weather against the fixture and returns the API payload", async () => {
    const { nockDone } = await nock.back("weather-api-current.json", backOptions);

    const result = await hooks.executeAction({
      actionId: "get_current_weather",
      parameters: { location: "London" },
    });

    const payload = JSON.parse(result) as {
      location: { name: string; country: string };
      current: { temp_c: number; condition: { text: string } };
    };

    expect(payload.location.name).toBe("London");
    expect(payload.location.country).toBe("United Kingdom");
    expect(typeof payload.current.temp_c).toBe("number");
    expect(payload.current.condition.text).toBeTruthy();

    nockDone();
  });
});
