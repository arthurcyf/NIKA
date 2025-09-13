import { NextRequest } from "next/server";
import { streamText, type CoreMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { FeatureCollection, Feature } from "geojson";
import { searchPlaces } from "@/lib/nominatim";
import { parseQuery } from "@/lib/parseQuery";
import { geocodeOne, estimateRadiusMeters } from "@/lib/geocode";
import { nearbyAmenities } from "@/lib/overpass";

export const runtime = "edge";
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  const body = await req.json();
  const uiMessages = (body?.messages ?? []) as any[];

  // latest user text
  const lastUser = [...uiMessages].reverse().find((m) => m?.role === "user");
  const userText = extractText(lastUser) || "cafes near one-north";

  // 1) parse query
  const { tags, location } = parseQuery(userText);

  let fc: FeatureCollection | null = null;

  if (tags.length && location) {
    // 2) geocode location -> center/radius
    const place = await geocodeOne(`${location}, Singapore`);
    if (place) {
      const center: [number, number] = [place.lon, place.lat];
      const radius = estimateRadiusMeters(place);

      // 3) Overpass search for amenities
      const over = await nearbyAmenities({
        center,
        radius,
        tags,
        limit: 50,
      });

      // optionally include the area polygon as a separate feature for context
      const areaFeature: Feature | null = place.geojson
        ? { type: "Feature", geometry: place.geojson, properties: { kind: "area", name: place.display_name } }
        : null;

      const features = [
        ...(areaFeature ? [areaFeature] : []),
        ...over.features,
      ];

      fc = { type: "FeatureCollection", features };
    }
  }

  // 4) fallback: basic Nominatim search (try a simplified query)
  if (!fc || fc.features.length === 0) {
    const simple = [
      tags[0] ?? "",
      location ?? "",
      "Singapore",
    ].filter(Boolean).join(" ").trim();

    const q = simple || userText;
    fc = await searchPlaces({ query: q, city: undefined, limit: 10 });
  }

  const fcString = JSON.stringify(fc ?? { type: "FeatureCollection", features: [] });

  // 5) ask the model for a brief write-up + echo EXACT GeoJSON
  const SYSTEM = `
You are Nika's location-intelligence assistant.

You have ALREADY been given a GeoJSON FeatureCollection for the user's request.
Write a short, friendly summary (1–2 sentences) of the recommended places, then
OUTPUT EXACTLY the FeatureCollection IN A FENCED \`\`\`geojson CODE BLOCK — DO NOT EDIT, PRETTY-PRINT, REORDER, OR MODIFY IT AT ALL.

Here is the GeoJSON to output verbatim inside the code block:
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

function extractText(msg: any): string {
  if (!msg) return "";
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map((p) => (typeof p?.text === "string" ? p.text : "")).join(" ").trim();
  }
  if (Array.isArray((msg as any).parts)) {
    return (msg as any).parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join(" ").trim();
  }
  return "";
}