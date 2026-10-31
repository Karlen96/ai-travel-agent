import OpenAI from 'openai';
import { tools, availableFunctions } from './tools.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const systemPrompt = `You are a friendly AI travel agent. Plan a trip from the details you get.
First call getWeatherForTrip exactly once, for the destination city and the trip dates. Base the weather part only on its result.
Then recommend:
- weather: 1-2 sentences in the style "You can expect the weather to be quite mild. Low will be 19° and high will be 25°" (use °C, mention if it is based on last year's weather).
- flights: one realistic option for this route (airline, direct or with a typical layover city) in one sentence.
- hotel: one specific, real hotel in the destination that fits the budget and number of travellers, in one sentence.
- activities: 4-5 short activity ideas that fit the destination and the expected weather.
Keep the whole trip within the budget. These are suggestions, you can't check live prices or availability.`;

// The response always has the same shape, so the frontend doesn't need to parse text
const tripSchema = {
  type: 'json_schema',
  json_schema: {
    name: 'trip',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        weather: { type: 'string' },
        flights: { type: 'string' },
        hotel: { type: 'string' },
        hotelName: { type: 'string', description: 'Only the hotel name, for a booking search' },
        activities: { type: 'array', items: { type: 'string' } },
      },
      required: ['weather', 'flights', 'hotel', 'hotelName', 'activities'],
      additionalProperties: false,
    },
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Same agent loop as lesson 04: the model requests tools, we run them until a final answer arrives
async function planTrip(openai, trip) {
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Travellers: ${trip.travellers}
Flying from: ${trip.from}
Flying to: ${trip.to}
From date: ${trip.startDate}
To date: ${trip.endDate}
Budget: $${trip.budget}`,
    },
  ];

  const MAX_ITERATIONS = 5;
  let gotToolResults = false;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools,
      // Small models tend to call tools in a loop. We already have the data, so forbid further calls
      // and force the model to give a final answer
      tool_choice: gotToolResults ? 'none' : 'auto',
      response_format: tripSchema,
    });
    const { finish_reason: finishReason, message } = response.choices[0];
    console.log(`iteration ${i + 1}: ${finishReason}`, message.tool_calls?.map((c) => `${c.function.name}(${c.function.arguments})`) ?? '');
    messages.push(message);

    if (finishReason === 'tool_calls') {
      for (const toolCall of message.tool_calls) {
        const fn = availableFunctions[toolCall.function.name];
        const result = fn
          ? await fn(JSON.parse(toolCall.function.arguments))
          : JSON.stringify({ error: `Unknown tool ${toolCall.function.name}` });
        messages.push({ tool_call_id: toolCall.id, role: 'tool', content: result });
      }
      gotToolResults = true;
      continue;
    }
    return JSON.parse(message.content);
  }
  throw new Error('Agent stopped: too many iterations');
}

function validateTrip(t) {
  const travellers = Number(t.travellers);
  const budget = Number(t.budget);
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!Number.isInteger(travellers) || travellers < 1 || travellers > 20) return 'travellers must be 1-20';
  if (!t.from?.trim() || !t.to?.trim()) return 'from and to are required';
  if (!date.test(t.startDate) || !date.test(t.endDate) || t.startDate > t.endDate) return 'invalid dates';
  if (!(budget > 0)) return 'budget must be positive';
  return null;
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only process POST requests
    if (request.method !== 'POST') {
      return json({ error: `${request.method} method not allowed.` }, 405);
    }

    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: 'https://gateway.ai.cloudflare.com/v1/b10456f5ff9d1cdc90dbc450fe4aa0d9/stock-predictions/openai',
    });
    const { pathname } = new URL(request.url);

    try {
      const body = await request.json();

      // POST /plan { travellers, from, to, startDate, endDate, budget } -> { weather, flights, hotel, hotelName, activities }
      if (pathname === '/plan') {
        const problem = validateTrip(body);
        if (problem) return json({ error: problem }, 400);
        return json(await planTrip(openai, body));
      }

      // POST /image { destination } -> { image: data URL }  (stretch goal: AI-generated image)
      if (pathname === '/image') {
        if (!body.destination?.trim()) return json({ error: 'destination is required' }, 400);
        const result = await openai.images.generate({
          model: 'gpt-image-1-mini',
          prompt: `A bright, cheerful travel postcard illustration of ${body.destination.slice(0, 100)}, iconic landmarks, no text`,
          size: '1024x1024',
          quality: 'low',
          output_format: 'jpeg',
          output_compression: 70,
        });
        return json({ image: `data:image/jpeg;base64,${result.data[0].b64_json}` });
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
