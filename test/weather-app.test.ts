import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import hooks from '../src/index';

// vi.hoisted builds the spies before src/index is imported.
const { createOrUpdateMock, MavenAGIClientMock } = vi.hoisted(() => {
  const createOrUpdate = vi.fn();
  return {
    createOrUpdateMock: createOrUpdate,
    // `function`, not an arrow, so `new MavenAGIClient(...)` works.
    MavenAGIClientMock: vi.fn(function () {
      return { actions: { createOrUpdate } };
    }),
  };
});

vi.mock('mavenagi', () => ({ MavenAGIClient: MavenAGIClientMock }));

const BASE_PARAMS = {
  organizationId: 'test-org',
  agentId: 'test-agent',
  settings: {},
};

const WEATHER_PAYLOAD = {
  location: { name: 'London', country: 'United Kingdom' },
  current: { temp_c: 12.5, condition: { text: 'Light rain' } },
};

/** Stub global fetch — no test here touches the network. */
function stubFetch(payload: unknown, { ok = true, status = 200 } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => payload,
  } as unknown as Response);

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const calledUrl = (fetchMock: ReturnType<typeof stubFetch>) =>
  String(fetchMock.mock.calls[0][0]);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('WEATHER_API_KEY', 'test-weather-api-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('preInstall', () => {
  it('rejects when WEATHER_API_KEY is unset', async () => {
    vi.stubEnv('WEATHER_API_KEY', '');

    await expect(hooks.preInstall()).rejects.toThrow(
      /WEATHER_API_KEY is not configured/
    );
  });

  it('resolves when a key is configured', async () => {
    await expect(hooks.preInstall()).resolves.toBeUndefined();
  });
});

describe('postInstall', () => {
  const LOCATION_PARAMETER = {
    id: 'location',
    label: 'Location',
    description: 'The location to get the weather for',
    required: true,
  };

  it('registers exactly the two weather actions', async () => {
    await hooks.postInstall(BASE_PARAMS);

    expect(MavenAGIClientMock).toHaveBeenCalledWith({
      organizationId: 'test-org',
      agentId: 'test-agent',
    });
    expect(createOrUpdateMock).toHaveBeenCalledTimes(2);
    expect(createOrUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: { referenceId: 'get_current_weather' },
        name: 'Get Current Weather',
        userFormParameters: [LOCATION_PARAMETER],
      })
    );
    expect(createOrUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: { referenceId: 'get_weather_forecast' },
        name: 'Get Weather Forecast',
        userFormParameters: [LOCATION_PARAMETER],
      })
    );
  });
});

describe('executeAction', () => {
  it('fetches current weather and returns the stringified payload', async () => {
    const fetchMock = stubFetch(WEATHER_PAYLOAD);

    const result = await hooks.executeAction({
      ...BASE_PARAMS,
      actionId: 'get_current_weather',
      parameters: { location: 'London' },
    });

    expect(result).toBe(JSON.stringify(WEATHER_PAYLOAD));
    expect(calledUrl(fetchMock)).toContain(
      'https://api.weatherapi.com/v1/current.json'
    );
    expect(calledUrl(fetchMock)).toContain('key=test-weather-api-key');
    expect(calledUrl(fetchMock)).toContain('q=London');
  });

  it('requests a 7-day forecast for the forecast action', async () => {
    const fetchMock = stubFetch(WEATHER_PAYLOAD);

    await hooks.executeAction({
      ...BASE_PARAMS,
      actionId: 'get_weather_forecast',
      parameters: { location: 'London' },
    });

    expect(calledUrl(fetchMock)).toContain(
      'https://api.weatherapi.com/v1/forecast.json'
    );
    expect(calledUrl(fetchMock)).toContain('days=7');
  });

  it('encodes a location that would otherwise inject query parameters', async () => {
    const fetchMock = stubFetch(WEATHER_PAYLOAD);

    await hooks.executeAction({
      ...BASE_PARAMS,
      actionId: 'get_weather_forecast',
      parameters: { location: 'London&days=1' },
    });

    const url = calledUrl(fetchMock);
    expect(url).toContain('q=London%26days%3D1');
    // The real `days=7` must remain the only unencoded `days` parameter.
    expect(url.match(/[?&]days=/g)).toHaveLength(1);
  });

  it('returns a plain message instead of the body when the API fails', async () => {
    stubFetch({ error: { code: 2006, message: 'API key is invalid.' } }, {
      ok: false,
      status: 401,
    });

    const result = await hooks.executeAction({
      ...BASE_PARAMS,
      actionId: 'get_current_weather',
      parameters: { location: 'London' },
    });

    expect(result).toBe('Unable to retrieve weather data. Please try again later.');
    expect(result).not.toContain('API key is invalid');
  });

  it("returns 'Unknown action' for an unrecognized actionId, without calling the API", async () => {
    const fetchMock = stubFetch(WEATHER_PAYLOAD);

    const result = await hooks.executeAction({
      ...BASE_PARAMS,
      actionId: 'get_weather_on_mars',
      parameters: { location: 'Olympus Mons' },
    });

    expect(result).toBe('Unknown action');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
