import { MavenAGIClient, MavenAGI } from 'mavenagi';
import weatherapi from 'weatherapi-sdk';

export default {
  async preInstall({ settings }) {
    // Validate the WeatherAPI key
    try {
      const weatherClient = new weatherapi.Client({ apiKey: settings.token });
      await weatherClient.getCurrentWeather({ location: 'San Francisco' });
    } catch (error) {
      throw new Error('Invalid WeatherAPI key');
    }
  },

  async postInstall({ organizationId, agentId, settings }) {
    const mavenAgi = new MavenAGIClient({ organizationId, agentId });

    // Create an action set for Weather APIs
    const actionSet = await mavenAgi.actions.createOrUpdateActionSet({
      id: 'weather_apis',
      name: 'Weather APIs',
    });

    // Create an action for getting current weather
    await mavenAgi.actions.createOrUpdateAction({
      id: 'get_current_weather',
      actionSetId: actionSet.id,
      appId: settings.appId,
      name: 'Get Current Weather',
      description: 'Fetch the current weather for a given location',
      userInteractionRequired: true,
      requiredUserContextFieldNames: ['location'],
      userFormParameters: [
        {
          id: 'location',
          description: 'The location to get the weather for',
        },
      ],
    });

    // Create an action for getting weather forecast
    await mavenAgi.actions.createOrUpdateAction({
      id: 'get_weather_forecast',
      actionSetId: actionSet.id,
      appId: settings.appId,
      name: 'Get Weather Forecast',
      description: 'Fetch the weather forecast for a given location',
      userInteractionRequired: true,
      requiredUserContextFieldNames: ['location', 'days'],
      userFormParameters: [
        {
          id: 'location',
          description: 'The location to get the weather forecast for',
        },
        {
          id: 'days',
          description: 'The number of days to get the forecast for',
        },
      ],
    });
  },

  async executeAction({
    organizationId,
    agentId,
    settings,
    actionId,
    payload,
  }) {
    const weatherClient = new weatherapi.Client({ apiKey: settings.token });
    let response;
    let markdown = '';

    if (actionId === 'get_current_weather') {
      response = await weatherClient.getCurrentWeather({
        location: payload.location,
      });
      markdown = `
        ## Current Weather for ${response.location.name}
        - **Temperature:** ${response.current.temperature}Â°C
        - **Condition:** ${response.current.condition.text}
        - **Humidity:** ${response.current.humidity}%
        - **Wind:** ${response.current.wind_kph} kph
      `;
    } else if (actionId === 'get_weather_forecast') {
      response = await weatherClient.getWeatherForecast({
        location: payload.location,
        days: payload.days,
      });
      markdown = `## Weather Forecast for ${response.location.name}\n`;
      response.forecast.forecastday.forEach((day) => {
        markdown += `
          ### ${day.date}
          - **Max Temperature:** ${day.day.maxtemp_c}Â°C
          - **Min Temperature:** ${day.day.mintemp_c}Â°C
          - **Condition:** ${day.day.condition.text}
        `;
      });
    } else {
      return 'Unknown action';
    }

    return markdown;
  },
};
