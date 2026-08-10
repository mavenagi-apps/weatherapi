import { MavenAGIClient } from 'mavenagi';

const weatherRequest = async (
  endpoint: string,
  params: Record<string, string>
) => {
  // URLSearchParams encodes every value, so an LLM-supplied location like "New York" or
  // "London&days=1" can't corrupt the query string or inject extra parameters.
  const query = new URLSearchParams({
    key: process.env.WEATHER_API_KEY ?? '',
    aqi: 'yes',
    ...params,
  });

  const response = await fetch(
    `https://api.weatherapi.com/v1/${endpoint}?${query}`
  );
  // Never return the error body — the agent would relay it as if it were weather data.
  if (!response.ok) {
    return 'Unable to retrieve weather data. Please try again later.';
  }

  return JSON.stringify(await response.json());
};

export default {
  async preInstall() {
    if (!process.env.WEATHER_API_KEY) {
      throw new Error(
        'WEATHER_API_KEY is not configured. Get a key at ' +
          'https://www.weatherapi.com/my/ and set it before installing this app.'
      );
    }
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
    if (actionId === 'get_current_weather') {
      return await weatherRequest('current.json', { q: parameters.location });
    }

    if (actionId === 'get_weather_forecast') {
      return await weatherRequest('forecast.json', {
        q: parameters.location,
        days: '7',
      });
    }

    return 'Unknown action';
  },
};
