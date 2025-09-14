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

## Project Pipeline
### 1. User tpes in the chat
- Chat.tsx (client) uses AI SDK React useChat to POST the whole message history to /api/chat and streams the assistant response back.

### 2. API builds the GeoJSON
`src/app/api/chat/route.ts` (Edge runtime) does three things **before** asking the model to speak:

- **Understands intent**: `parseQuery()` pulls simple tags (e.g., `["cafe"]`) and a location phrase (e.g., “one-north”, “junction 8”).
- **Finds a search center**:
    - If the new turn has a location → `geocodeOne()` (Nominatim) → center + area polygon.
    - Else reuse the **last target** from earlier assistant messages by parsing the previous ```geojson block (our “sticky location”).

- **Gets POIs**:
    - Prefer **Overpass** via `nearbyAmenities(center, radius, tags)` → compute distances, **sort**, **top 5**.
    - Fallback to **Nominatim** `searchPlaces()` and still rank by distance if we have a center.

**For Example**
“**Find team-friendly cafés near Junction 8**”
→ Geocode **Junction 8** → center at the mall
→ Overpass: `amenity=cafe` within ~900 m
→ Sort by distance → keep 5 → return as blue pins
→ If none found, Nominatim `"cafe Junction 8"` → rank (if center known) → keep 5.

**use Overpass for nearby category search; else fall back to Nominatim; always return the 5 closest.**

- It then **constructs one FeatureCollection** with:
    - `properties.kind = "area"` (polygon, if available)
    - `properties.kind = "target"` (the red pin)
    - `properties.kind = "poi"` (the 5 blue pins, nearest first)

3. **API streams a short summary + the exact GeoJSON.**
    
    The API calls `streamText()` with:
    
    - full chat history (`convertToModelMessages(uiMessages)`),
    - a system prompt (“keep it short, then echo this FeatureCollection in a ```geojson block”),
    - and the FeatureCollection string.

4. **Client renders the chat and updates the map.**
    - `Chat.tsx` streams text; it **hides any JSON** in the bubble and, on finish, **extracts the last ```geojson block**, parses it, and calls `onGeoJSON(fc)`.
    - `page.tsx` stores `fc` in state and passes it to the map.
    - `Map.tsx` updates a single GeoJSON **source** and styled **layers**:
        - polygon fill/outline,
        - **red** circle for `kind:"target"`,
        - **blue** circles for POIs (`kind:"poi"`),
        - hover tooltips + click popups,
        - auto **fitBounds** to all features.

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

## What each file does:

### App shell & styling

- **`src/app/page.tsx`**
    
    Two-column layout: **left sidebar** (chat) + **right** (map). Holds `geojson` state and wires `onGeoJSON` from chat → map.
    
- **`src/app/globals.css`**
    
    Global font (**Segoe UI**), sidebar layout (`.shell`, `.sidebar`, `.mapWrap`), ChatGPT-style **bubbles**, “Places panel”, and small CSS for **map popups**.
    
- **`src/app/layout.tsx`** *(if present)*
    
    Next.js root layout wrapper (metadata, `<body>`). No logic.

### Chat & Map (client)

- **`src/components/Chat.tsx`**
    - Uses `useChat({ api: "/api/chat" })` to stream messages.
    - **Never shows raw GeoJSON**: strips fenced ````geojson` / ````json` blocks (even partial during streaming).
    - On `onFinish`, parses the GeoJSON from the assistant text and calls `onGeoJSON(fc)`.
    - Renders a tidy list of places from the latest `FeatureCollection` (points only, **max 5**).
    - Defensive text wrapping (`overflow-wrap:anywhere`) so nothing overflows the sidebar.
- **`src/components/Map.tsx` -**
    - **MapLibre** setup, one GeoJSON **source** `"places"`.
    - Layers: to visualize design
        - `"places-fill"` (Polygon fill, soft purple)
        - `"places-line"` (Polygon outline)
        - `"target-point"` (red circle)
        - `"poi-points"` (blue circles)
    - **Hover tooltips** (reused popup) + **click popups** with name/amenity.
    - `updateDataAndFit()` sets source data and **fits** the map to all features.
    - Filters by `["get","kind"]` to distinguish area/target/poi.

### API (server / edge)

- **`src/app/api/chat/route.ts`**
    - **Context:** passes **full history** to the model; also implements **sticky location memory** by parsing the previous assistant’s GeoJSON to reuse the last `target` when the user omits a location (“cheap options”, “more”, etc.).
    - **Intent & center:** `parseQuery()` pulls tags and an optional location; `geocodeOne()` resolves place (center + polygon); `estimateRadiusMeters()` or `approximateRadiusFromArea()` derives a sensible radius.
    - **POIs:** `nearbyAmenities()` (Overpass) → compute distance with `haversineMeters()`, sort, **slice(0,5)**; fallback `searchPlaces()` (Nominatim).
    - **Output:** composes a canonical **FeatureCollection** with `kind: "area" | "target" | "poi"`, injects it into a system message, and **streams** a short summary + fenced ```geojson block.
    - **Helpers:**
        - `extractLastTargetFromHistory()` → parses the **last** ```geojson block from prior assistant messages to recover `center`/area.
        - `extractGeoJSON()` → global-regex `matchAll` to grab the last fenced block.
        - `centroidFromArea()` / `approximateRadiusFromArea()` for polygons.

### Data providers (server utilities)

- **`src/lib/geocode.ts`**
    
    `geocodeOne(q)` (Nominatim) → `{ display_name, lat, lon, geojson? }`.
    
    `estimateRadiusMeters(place)` – estimate search radius from bbox/geometry.
    
- **`src/lib/overpass.ts`**
    
    `nearbyAmenities({ center, radius, tags, limit })` – Overpass Turbo query for OSM **amenity** nodes; returns a **Point FeatureCollection** (we set `properties.kind="poi"`).
    
- **`src/lib/nominatim.ts`**
    
    `searchPlaces({ query, limit })` – Nominatim search; normalizes to a FeatureCollection (points, sometimes polygons).
    
- **`src/lib/parseQuery.ts`**
    
    Tiny heuristic to read user phrasing into `tags` (e.g., `["cafe"]`, `["lunch"]`, `["vegetarian"]`) and a coarse **location** phrase after “near/around/at/in …”.

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

## Ways to make the chatbot more scalable:
- Cache everything you can: geocodes, Overpass queries, and model outputs.
    - Key things to cache with TTLs:
    - searchPlaces(query) → 1–6h
- Rolling conversation summary so you don’t resend a huge chat history.
- H3 / grid-based search
    - Instead of raw radius each time, pre-bucket POIs into H3 cells, then query concentric rings around the center until you collect N candidates. This avoids scanning the whole world and is cache-friendly.
    - How it works (algorithm)
        - Convert the center (your red pin) to a cell at a chosen resolution (e.g., 8).
        - Look up POIs cached for that cell ID.
        - If you still need more, expand to the next ring of neighbor cells, merge results, stop once you reach N candidates (e.g., 5).
        - Sort by distance to the actual center and keep the top N.
