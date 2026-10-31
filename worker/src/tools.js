// Agent tool: weather at the destination for the trip dates (Open-Meteo, no API key).
// Forecasts only cover ~16 days ahead. For later dates we use the same days one year earlier —
// a fair estimate for trip planning, and the model is told so (the source field).

const FORECAST_DAYS = 15;

function describeWeatherCode(code) {
  if (code === 0) return "clear sky";
  if (code <= 3) return "partly cloudy";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorm";
}

function shiftYear(date, years) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export async function getWeatherForTrip({ city, startDate, endDate }) {
  try {
    const geo = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
    ).then((r) => r.json());
    const place = geo.results?.[0];
    if (!place) return JSON.stringify({ error: `Unknown city: ${city}` });

    const daysAhead = (new Date(`${endDate}T00:00:00Z`) - Date.now()) / 86_400_000;
    const useForecast = daysAhead <= FORECAST_DAYS && new Date(`${startDate}T23:59:59Z`) >= Date.now();
    // One year before the trip dates (or the dates themselves if the trip is in the past)
    const back = useForecast ? 0 : Math.max(1, new Date(startDate).getUTCFullYear() - new Date().getUTCFullYear() + 1);

    const params = new URLSearchParams({
      latitude: place.latitude,
      longitude: place.longitude,
      start_date: shiftYear(startDate, -back),
      end_date: shiftYear(endDate, -back),
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code",
      timezone: "auto",
    });
    const base = useForecast ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
    const data = await fetch(`${base}?${params}`).then((r) => r.json());
    if (data.error) return JSON.stringify({ error: data.reason });

    const { temperature_2m_max: max, temperature_2m_min: min, precipitation_sum: rain, weather_code: codes } = data.daily;
    const counts = {};
    for (const c of codes) counts[describeWeatherCode(c)] = (counts[describeWeatherCode(c)] ?? 0) + 1;
    const rainyDays = rain.filter((mm) => mm >= 1).length;

    return JSON.stringify({
      location: `${place.name}, ${place.country}`,
      source: useForecast ? "forecast" : `actual weather on the same dates ${back} year(s) ago (forecast not available that far ahead)`,
      lowC: Math.round(Math.min(...min)),
      highC: Math.round(Math.max(...max)),
      rainyDays: `${rainyDays} of ${rain.length}`,
      mostly: Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0],
    });
  } catch (err) {
    return JSON.stringify({ error: err.message });
  }
}

export const tools = [
  {
    type: "function",
    function: {
      name: "getWeatherForTrip",
      description: "Get the expected weather in a city for the dates of the trip",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "Destination city name, e.g. Paris" },
          startDate: { type: "string", description: "First day of the trip, YYYY-MM-DD" },
          endDate: { type: "string", description: "Last day of the trip, YYYY-MM-DD" },
        },
        required: ["city", "startDate", "endDate"],
      },
    },
  },
];

export const availableFunctions = { getWeatherForTrip };
