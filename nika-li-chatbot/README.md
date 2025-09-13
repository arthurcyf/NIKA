# Nika LI Chatbot

### A minimal location-intelligence chatbot for Nika employees. It combines:

- Next.js 15 (App Router) + React 19
- Vercel AI SDK v5 (streaming chat UI)
- MapLibre GL JS (interactive map)
- OpenAI gpt-5-mini (responses)

### OpenStreetMap data sources:

- Nominatim for geocoding & polygons
- Overpass for nearby amenities (cafés, restaurants, etc.)

The bot parses a natural-language query (e.g., “team-friendly cafés near One-North”), fetches real locations, then streams a short write-up plus a FeatureCollection in a fenced ```geojson block. The map listens for that block and renders it live.

## Project Structure
```
    src/
  app/
    api/
      chat/
        route.ts           # API route: parse → geocode → Overpass/Nominatim → stream LLM + GeoJSON
    page.tsx               # Layout: Chat + Map; memoized onGeoJSON handler
    globals.css            # Minimal styles
  components/
    Chat.tsx               # Streaming chat UI (uses @ai-sdk/react)
    Map.tsx                # MapLibre map; ensures sources/layers; fits bounds
  lib/
    parseQuery.ts          # Tiny heuristic parser for tags & location
    geocode.ts             # Nominatim geocode + radius estimate from bounding box
    nominatim.ts           # Nominatim search → FeatureCollection (polygons when available)
    overpass.ts            # Overpass (amenities around center) → FeatureCollection (Points)
```
## Prerequisites

- Node.js 18+ (recommended 18.18 or 20+)
- npm 9+ (or Yarn)
- Internet access (Nominatim/Overpass/OpenAI)
- An OpenAI API key (assignment’s temporary key is supported; please use gpt-5-mini only)

## Setup

***1. Clone & install***
```
    git clone <your-repo-url>
    cd nika-li-chatbot
    npm install
```

    - If npm is picky with peer deps on your machine, you can do:
```
    npm install --legacy-peer-deps
```

***2. Environment variables (at project root)***
- Create .env.local:

```
    OPENAI_API_KEY=sk-proj-...your-temp-key...
    NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- The app only uses gpt-5-mini per the brief.

***3. Run***
```
    npm run dev
```

- Open http://localhost:3000

## How it works (server flow)

1. Parse the last user message to extract:
    - tags: e.g., ["cafe"], ["restaurant"], ["bar"]
    - location: text after near/around/in (e.g., “One-North”)

2. Geocode with Nominatim to get:
    - center ([lon, lat])
    - bounding box → rough radius estimate
    - optional polygon for context

3. Overpass query for amenity nodes within radius of center.

4. Fallback: if nothing found, do a Nominatim search of a simplified query.

5. Ask OpenAI for a concise write-up and instruct it to echo the exact GeoJSON we computed inside a fenced ```geojson block.

6. The client parses that code block and updates the map (and auto-fits bounds).

## Map details

- Adds a GeoJSON source named places.
- Layers:
    - places-fill (polygons; filter uses ["==", ["geometry-type"], "Polygon"])
    - places-line (outlines)
    - places-points (circles for amenities)
- Waits for map.on('load') before touching sources/layers.
- Idempotent: recreates sources/layers if dev remounts occur (React StrictMode).

## Chat details

- Uses @ai-sdk/react v5 hook useChat.
- We control input with local state (v5 no longer provides input/setInput).
- On finish, we parse the last assistant message for a fenced ```geojson block and pass the FeatureCollection to the map.


## API keys & etiquette
- Keep OPENAI_API_KEY in .env.local (never commit).

## Try these prompts

“Find team-friendly cafés near One-North, Singapore, and show them on the map.”

“Recommend lunch spots near NTU with vegetarian options; show on map.”

“Chill bars in Tanjong Pagar — map them.”

“Good coffee around Changi Business Park.”