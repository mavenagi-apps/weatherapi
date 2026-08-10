import path from "path";

import nock from "nock";
import { afterAll, beforeAll } from "vitest";

const back = nock.back;

// Fixtures directory — all E2E fixtures live here
back.fixtures = path.resolve(__dirname, "__fixtures__");

// NOCK_RECORD=true → record real HTTP and save fixtures
// CI or default → lockdown (fixtures must exist, no network)
if (process.env.NOCK_RECORD === "true") {
  back.setMode("record");
} else {
  back.setMode("lockdown");
}

/**
 * Placeholder written into fixtures in place of any real secret.
 * Also used by the tests to force `WEATHER_API_KEY` during replay so the outgoing request
 * path matches what the committed fixture recorded.
 */
export const REDACTED = "REDACTED";

/**
 * Query-string parameters that carry credentials and must never be committed.
 * WeatherAPI authenticates with `?key=<apiKey>`, so `key` is the load-bearing entry here:
 * without it, a single `pnpm test:e2e:record` run would write a live API key into a fixture
 * in this PUBLIC repo.
 */
const SENSITIVE_QUERY_PARAMS = [
  "key",
  "apikey",
  "api_key",
  "access_token",
  "token",
  "signature",
];

/** Request/response headers commonly carrying credentials or session state. */
const SENSITIVE_HEADERS = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "x-amz-security-token",
];

/** Replace the value of every sensitive query param in a recorded request path. */
function redactPath(recordedPath: string): string {
  return SENSITIVE_QUERY_PARAMS.reduce(
    (acc, param) =>
      acc.replace(
        new RegExp(`([?&]${param}=)[^&]*`, "gi"),
        (_match, prefix: string) => `${prefix}${REDACTED}`,
      ),
    recordedPath,
  );
}

/**
 * Strip sensitive headers from a nock header bag. Nock records headers either as an object
 * map (`reqheaders`, and `rawHeaders` in some versions) or as a flat `[name, value, ...]`
 * array, so both shapes are handled.
 */
function redactHeaders(headers: unknown): unknown {
  if (Array.isArray(headers)) {
    return headers.map((entry, index) =>
      index % 2 === 1 &&
      typeof headers[index - 1] === "string" &&
      SENSITIVE_HEADERS.includes(String(headers[index - 1]).toLowerCase())
        ? REDACTED
        : entry,
    );
  }

  if (headers && typeof headers === "object") {
    return Object.fromEntries(
      Object.entries(headers as Record<string, unknown>).map(([name, value]) =>
        SENSITIVE_HEADERS.includes(name.toLowerCase())
          ? [name, REDACTED]
          : [name, value],
      ),
    );
  }

  return headers;
}

/**
 * Options passed to every `nock.back()` call.
 *
 * `afterRecord` only runs while recording (`NOCK_RECORD=true`); it is the last hook before
 * nock serializes fixtures to disk, which makes it the right place to scrub secrets. This
 * redaction used to come from a shared Maven dev package, but this app is the PUBLIC
 * reference app and must install with no Maven npm credentials, so it is hand-rolled here
 * with no Maven-scoped dependency of any kind (not even a devDependency).
 */
export const backOptions: nock.BackOptions = {
  afterRecord: (definitions) =>
    definitions.map((definition) => {
      // Widened: recorded fixtures carry `rawHeaders` alongside the typed `headers` field,
      // and nock's `Definition` type does not declare it.
      const recorded = definition as nock.Definition & {
        rawHeaders?: unknown;
      };

      return {
        ...recorded,
        path:
          typeof recorded.path === "string"
            ? redactPath(recorded.path)
            : recorded.path,
        reqheaders: redactHeaders(
          recorded.reqheaders,
        ) as nock.Definition["reqheaders"],
        headers: redactHeaders(recorded.headers) as nock.Definition["headers"],
        rawHeaders: redactHeaders(recorded.rawHeaders),
      };
    }),
};

beforeAll(() => {
  if (process.env.NOCK_RECORD === "true") {
    nock.enableNetConnect();
  }
});

afterAll(() => {
  nock.cleanAll();
  nock.restore();
});
