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

export default {
  async preInstall() {},

  async postInstall({ organizationId, agentId }) {
    const mavenAgi = new MavenAGIClient({
      xOrganizationId: organizationId,
      xAgentId: agentId,
    });

    // Create an action for getting current weather
    await mavenAgi.actions.createOrUpdateAction({
      entityId: { referenceId: 'get_current_weather' },
      name: 'Get Current Weather',
      description: 'Fetch the current weather for a given location',
      userInteractionRequired: false,
      requiredUserContextFieldNames: new Set(),
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
    await mavenAgi.actions.createOrUpdateAction({
      entityId: { referenceId: 'get_weather_forecast' },
      name: 'Get Weather Forecast',
      description:
        'Fetch the weather forecast for a given location for the next 7 days',
      userInteractionRequired: false,
      requiredUserContextFieldNames: new Set(),
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
