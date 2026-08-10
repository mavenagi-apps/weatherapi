import { MavenAGIClient, MavenAGI } from 'mavenagi';

const makeWeatherRequest = async (location: string) => {
  const response = await fetch(
    `https://api.weatherapi.com/v1/current.json?key=${process.env.WEATHER_API_KEY}&q=${location}&aqi=yes`
  );
  return await response.json();
};

const makeWeatherForecastRequest = async (location: string) => {
  const response = await fetch(
    `https://api.weatherapi.com/v1/forecast.json?key=${process.env.WEATHER_API_KEY}&q=${location}&days=7&aqi=yes`
  );
  return await response.json();
};

/**
 * Confirms the configured API key actually works, by making the cheapest real request
 * WeatherAPI offers. Errors thrown from `preInstall` are shown to the person installing
 * the app and block the install — which is where a bad key should surface. Without this,
 * installation always succeeds and the failure instead lands mid-conversation, where
 * WeatherAPI's error body gets handed to the LLM as though it were weather data.
 */
const verifyApiKey = async (apiKey: string) => {
  let response: Response;
  try {
    response = await fetch(
      `https://api.weatherapi.com/v1/current.json?key=${encodeURIComponent(apiKey)}&q=London`
    );
  } catch (cause) {
    throw new Error(
      'Could not reach weatherapi.com to verify WEATHER_API_KEY. ' +
        'Check network access from the app environment and try again.',
      { cause }
    );
  }

  if (response.ok) return;

  // WeatherAPI reports key problems as a 401 with an `error.message` explaining which
  // one (not provided, invalid, disabled, out of quota). Pass its wording straight
  // through rather than guessing, and fall back if the body isn't the shape we expect.
  const reason = await response
    .json()
    .then((body) => body?.error?.message)
    .catch(() => undefined);

  throw new Error(
    `WEATHER_API_KEY was rejected by weatherapi.com (HTTP ${response.status}): ` +
      `${reason ?? 'no reason given'} ` +
      'Check the key on your account at https://www.weatherapi.com/my/.'
  );
};

export default {
  async preInstall() {
    const apiKey = process.env.WEATHER_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        'WEATHER_API_KEY is not configured. Set it in the app environment to an API key ' +
          'from https://www.weatherapi.com/my/ before installing this app.'
      );
    }

    await verifyApiKey(apiKey);
  },

  async postInstall({ organizationId, agentId }) {
    const mavenAgi = new MavenAGIClient({
      organizationId: organizationId,
      agentId: agentId,
    });

    // Create an action for getting current weather
    await mavenAgi.actions.createOrUpdate({
      actionId: { referenceId: 'get_current_weather' },
      name: 'Get Current Weather',
      description: 'Fetch the current weather for a given location',
      userInteractionRequired: false,
      userFormParameters: [
        {
          id: 'location',
          label: 'Location',
          description: 'The location to get the weather for',
          required: true,
        },
      ],
    });

    // Create an action for getting weather forecast
    await mavenAgi.actions.createOrUpdate({
      actionId: { referenceId: 'get_weather_forecast' },
      name: 'Get Weather Forecast',
      description:
        'Fetch the weather forecast for a given location for the next 7 days',
      userInteractionRequired: false,
      userFormParameters: [
        {
          id: 'location',
          label: 'Location',
          description: 'The location to get the weather for',
          required: true,
        },
      ],
    });
  },

  async executeAction({ actionId, parameters }) {
    console.log('action request for ' + actionId);
    if (actionId === 'get_current_weather') {
      const data = await makeWeatherRequest(parameters.location);
      return JSON.stringify(data);
    } else if (actionId === 'get_weather_forecast') {
      const data = await makeWeatherForecastRequest(parameters.location);
      return JSON.stringify(data);
    } else {
      return 'Unknown action';
    }
  },
};
