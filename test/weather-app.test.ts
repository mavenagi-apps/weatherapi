import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import hooks from "@/index";

// ---------------------------------------------------------------------------
// Maven SDK mock
//
// `src/index.ts` news up a `MavenAGIClient` inside `postInstall`, so the mock has to be
// in place before the module under test is imported. `vi.hoisted` builds the spies first,
// then `vi.mock` (which is itself hoisted) wires them into the module registry.
//
// This app is the public reference app: it must stay installable by external developers
// with no Maven npm credentials, so the SDK is mocked by hand here rather than pulled in
// from a private Maven-scoped test helper package.
// ---------------------------------------------------------------------------
const { createOrUpdateMock, MavenAGIClientMock } = vi.hoisted(() => {
  const createOrUpdate = vi.fn();
  return {
    createOrUpdateMock: createOrUpdate,
    // Declared with `function` rather than an arrow so `new MavenAGIClient(...)` works.
    MavenAGIClientMock: vi.fn(function () {
      return { actions: { createOrUpdate } };
    }),
  };
});

vi.mock("mavenagi", () => ({
  MavenAGIClient: MavenAGIClientMock,
  // `src/index.ts` also imports the `MavenAGI` namespace; it is types-only at runtime,
  // but the import is emitted, so the mock must expose something for it.
  MavenAGI: {},
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const BASE_PARAMS = {
  organizationId: "test-org",
  agentId: "test-agent",
  settings: {},
};

/** Stand-in for a WeatherAPI `current.json` body. */
const CURRENT_PAYLOAD = {
  location: { name: "London", country: "United Kingdom" },
  current: { temp_c: 12.5, condition: { text: "Light rain" } },
};

/** Stand-in for a WeatherAPI `forecast.json` body. */
const FORECAST_PAYLOAD = {
  location: { name: "London", country: "United Kingdom" },
  forecast: { forecastday: [{ date: "2026-08-09", day: { maxtemp_c: 24.1 } }] },
};

/**
 * Replace global `fetch` with a spy resolving `payload` as JSON.
 * Every unit test runs against this — no test in this file is allowed to touch the network.
 */
function stubFetch(payload: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response);

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WEATHER_API_KEY", "test-weather-api-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// preInstall — API key guard
//
// Errors thrown here are shown to the installer and block the install, so each case
// asserts on the message the installer would actually read, not just that it threw.
// ---------------------------------------------------------------------------
describe("preInstall", () => {
  /** Replace global `fetch` with a spy resolving a non-OK response carrying `body`. */
  function stubFailedFetch(status: number, body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => body,
    } as unknown as Response);

    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("rejects when WEATHER_API_KEY is unset, without calling the API", async () => {
    vi.stubEnv("WEATHER_API_KEY", "");
    const fetchMock = stubFetch(CURRENT_PAYLOAD);

    await expect(hooks.preInstall()).rejects.toThrow(
      /WEATHER_API_KEY is not configured[\s\S]*weatherapi\.com\/my/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only key as unset", async () => {
    vi.stubEnv("WEATHER_API_KEY", "   ");
    const fetchMock = stubFetch(CURRENT_PAYLOAD);

    await expect(hooks.preInstall()).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies the key against WeatherAPI and resolves when accepted", async () => {
    const fetchMock = stubFetch(CURRENT_PAYLOAD);

    await expect(hooks.preInstall()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/v1/current.json");
    expect(url).toContain("key=test-weather-api-key");
  });

  it("surfaces WeatherAPI's own reason when the key is rejected", async () => {
    // Verbatim 401 body returned by api.weatherapi.com for an invalid key.
    stubFailedFetch(401, { error: { code: 2006, message: "API key is invalid." } });

    await expect(hooks.preInstall()).rejects.toThrow(
      /rejected by weatherapi\.com \(HTTP 401\): API key is invalid\./,
    );
  });

  it("still reports something useful when the error body is not the expected shape", async () => {
    stubFailedFetch(403, "<html>gateway error</html>");

    await expect(hooks.preInstall()).rejects.toThrow(/HTTP 403[\s\S]*no reason given/);
  });

  it("explains a network failure rather than leaking the raw fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(hooks.preInstall()).rejects.toThrow(
      /Could not reach weatherapi\.com to verify WEATHER_API_KEY/,
    );
  });
});

// ---------------------------------------------------------------------------
// postInstall — action registration
// ---------------------------------------------------------------------------
describe("postInstall", () => {
  const LOCATION_PARAMETER = {
    id: "location",
    label: "Location",
    description: "The location to get the weather for",
    required: true,
  };

  it("registers the current-weather action", async () => {
    await hooks.postInstall(BASE_PARAMS);

    expect(createOrUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: { referenceId: "get_current_weather" },
        name: "Get Current Weather",
        userFormParameters: [LOCATION_PARAMETER],
      }),
    );
  });

  it("registers the forecast action", async () => {
    await hooks.postInstall(BASE_PARAMS);

    expect(createOrUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: { referenceId: "get_weather_forecast" },
        name: "Get Weather Forecast",
        userFormParameters: [LOCATION_PARAMETER],
      }),
    );
  });

  it("registers exactly the two weather actions", async () => {
    await hooks.postInstall(BASE_PARAMS);

    expect(createOrUpdateMock).toHaveBeenCalledTimes(2);
    expect(MavenAGIClientMock).toHaveBeenCalledWith({
      organizationId: "test-org",
      agentId: "test-agent",
    });
  });
});

// ---------------------------------------------------------------------------
// executeAction
// ---------------------------------------------------------------------------
describe("executeAction", () => {
  it("fetches current weather and returns the stringified payload", async () => {
    const fetchMock = stubFetch(CURRENT_PAYLOAD);

    const result = await hooks.executeAction({
      ...BASE_PARAMS,
      actionId: "get_current_weather",
      parameters: { location: "London" },
    });

    expect(result).toBe(JSON.stringify(CURRENT_PAYLOAD));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("https://api.weatherapi.com/v1/current.json");
    expect(url).toContain("key=test-weather-api-key");
    expect(url).toContain("q=London");
    expect(url).toContain("aqi=yes");
  });

  it("fetches the 7-day forecast and returns the stringified payload", async () => {
    const fetchMock = stubFetch(FORECAST_PAYLOAD);

    const result = await hooks.executeAction({
      ...BASE_PARAMS,
      actionId: "get_weather_forecast",
      parameters: { location: "London" },
    });

    expect(result).toBe(JSON.stringify(FORECAST_PAYLOAD));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("https://api.weatherapi.com/v1/forecast.json");
    expect(url).toContain("key=test-weather-api-key");
    expect(url).toContain("q=London");
    expect(url).toContain("days=7");
  });

  it("returns 'Unknown action' for an unrecognized actionId and never calls the network", async () => {
    const fetchMock = stubFetch(CURRENT_PAYLOAD);

    const result = await hooks.executeAction({
      ...BASE_PARAMS,
      actionId: "get_weather_on_mars",
      parameters: { location: "Olympus Mons" },
    });

    expect(result).toBe("Unknown action");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
