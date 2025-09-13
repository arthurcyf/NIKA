import { NextRequest } from "next/server";
import { streamText, type CoreMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Feature, FeatureCollection, Point } from "geojson";
import { searchPlaces } from "@/lib/nominatim";
import { parseQuery } from "@/lib/parseQuery";
import { geocodeOne, estimateRadiusMeters } from "@/lib/geocode";
import { nearbyAmenities } from "@/lib/overpass";

export const runtime = "edge";
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  const body = await req.json();
  const uiMessages = (body?.messages ?? []) as any[];

  const lastUser = [...uiMessages].reverse().find((m) => m?.role === "user");
  const userText = extractText(lastUser) || "cafes near one-north";

  const { tags, location } = parseQuery(userText);

  let fc: FeatureCollection | null = null;

  if (tags.length && location) {
    const place = await geocodeOne(`${location}, Singapore`);
    if (place) {
      const center: [number, number] = [place.lon, place.lat];
      const radius = estimateRadiusMeters(place);

      const over = await nearbyAmenities({ center, radius, tags, limit: 120 });

      // compute distance for points, sort, top 5
      const points = over.features
        .filter((f) => f.geometry?.type === "Point")
        .map((f) => {
          const coords = (f.geometry as Point).coordinates as [number, number];
          const dist_m = haversineMeters(center, coords);
          (f.properties as any) = { ...(f.properties || {}), dist_m, kind: "poi" };
          return f;
        })
        .sort((a, b) => ((a.properties as any).dist_m ?? 0) - ((b.properties as any).dist_m ?? 0))
        .slice(0, 5);

      const areaFeature: Feature | null = place.geojson
        ? { type: "Feature", geometry: place.geojson, properties: { kind: "area", name: place.display_name } }
        : null;

      const targetFeature: Feature = {
        type: "Feature",
        geometry: { type: "Point", coordinates: center },
        properties: { kind: "target", name: place.display_name },
      };

      fc = { type: "FeatureCollection", features: [ ...(areaFeature ? [areaFeature] : []), targetFeature, ...points ] };
    }
  }

  // Fallback: try Nominatim search (still prefer nearest 5 if we have a center)
  if (!fc || fc.features.length === 0) {
    // try to geocode a center anyway (best-effort)
    const geocoded = location ? await geocodeOne(`${location}, Singapore`) : await geocodeOne("Singapore");
    const center: [number, number] | null = geocoded ? [geocoded.lon, geocoded.lat] as [number, number] : null;

    const simpleQ = [tags[0] ?? "", location ?? "", "Singapore"].filter(Boolean).join(" ").trim() || userText;
    const nom = await searchPlaces({ query: simpleQ, limit: 30 });

    const points = nom.features
      .filter((f) => f.geometry?.type === "Point")
      .map((f) => {
        const coords = (f.geometry as Point).coordinates as [number, number];
        const dist_m = center ? haversineMeters(center, coords) : Number.POSITIVE_INFINITY;
        (f.properties as any) = { ...(f.properties || {}), dist_m, kind: "poi" };
        return f;
      })
      .sort((a, b) => ((a.properties as any).dist_m ?? 0) - ((b.properties as any).dist_m ?? 0))
      .slice(0, 5);

    const features: Feature[] = [];

    if (geocoded?.geojson) {
      features.push({ type: "Feature", geometry: geocoded.geojson, properties: { kind: "area", name: geocoded.display_name } });
    }
    if (center) {
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: center }, properties: { kind: "target", name: geocoded?.display_name || "Target" } });
    }
    features.push(...points);

    fc = { type: "FeatureCollection", features };
  }

  const fcString = JSON.stringify(fc ?? { type: "FeatureCollection", features: [] });

  const SYSTEM = `
You are Nika's location-intelligence assistant.
You have ALREADY been given a GeoJSON FeatureCollection (area polygon, a red 'target' point, and up to 5 nearest POIs as blue points).
Write a short, friendly summary (1–2 sentences) and then OUTPUT EXACTLY the FeatureCollection IN A FENCED \`\`\`geojson CODE BLOCK — DO NOT MODIFY IT.
${fcString}
`.trim();

  const coreMessages: CoreMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: userText },
  ];

  const result = await streamText({
    model: openai("gpt-5-mini"),
    messages: coreMessages,
    maxTokens: 800,
  });

  return result.toUIMessageStreamResponse();
}

/* helpers */
function extractText(msg: any): string {
  if (!msg) return "";
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p?.text === "string" ? p.text : "")).join(" ").trim();
  if (Array.isArray((msg as any).parts)) return (msg as any).parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join(" ").trim();
  return "";
}

function haversineMeters(a: [number, number], b: [number, number]) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const R = 6371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const la1 = toRad(lat1);
  const la2 = toRad(lat2);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
