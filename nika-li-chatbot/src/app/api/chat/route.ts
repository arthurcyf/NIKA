import { NextRequest } from "next/server";
import {
  streamText,
  convertToModelMessages,
  type UIMessage,
  type CoreMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from "geojson";
import { parseQuery } from "@/lib/parseQuery";
import { geocodeOne, estimateRadiusMeters } from "@/lib/geocode";
import { nearbyAmenities } from "@/lib/overpass";
import { searchPlaces } from "@/lib/nominatim";

export const runtime = "edge";
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  const body = await req.json();
  const uiMessages = (body?.messages ?? []) as UIMessage[];

  // 1) What did the user just ask?
  const lastUserText = extractLastUserText(uiMessages) || "";

  // 2) Parse simple intent (tags + optional location words)
  const { tags, location } = parseQuery(lastUserText);

  // 3) Sticky target from history (scan previous assistant replies for last FeatureCollection)
  const sticky = extractLastTargetFromHistory(uiMessages); // { center?, name?, areaFeature?, radius? }

  // 4) Resolve a working center/area
  let center: [number, number] | null = null;
  let areaFeature: Feature | null = null;
  let areaName = sticky?.name || "";

  // Preferred: explicit new location → geocode
  if (location) {
    const place = await geocodeOne(`${location}, Singapore`);
    if (place) {
      center = [place.lon, place.lat];
      areaName = place.display_name;
      if (place.geojson) {
        areaFeature = {
          type: "Feature",
          geometry: place.geojson,
          properties: { kind: "area", name: place.display_name },
        };
      }
    }
  }

  // Fallback: re-use sticky target
  if (!center && sticky?.center) {
    center = sticky.center;
    areaName = sticky.name || areaName || "Target";
    if (sticky.areaFeature) areaFeature = sticky.areaFeature;
  }

  // 5) Build features: top-5 nearest POIs around center (Overpass), else fallback (Nominatim)
  let fc: FeatureCollection | null = null;

  if (tags.length && center) {
    const radius =
      sticky?.radius ??
      (sticky?.areaFeature ? approximateRadiusFromArea(sticky.areaFeature) : null) ??
      900; // meters default if we didn't geocode a bbox
    const over = await nearbyAmenities({ center, radius, tags, limit: 120 });

    const points = over.features
      .filter((f) => f.geometry?.type === "Point")
      .map((f) => {
        const coords = (f.geometry as Point).coordinates as [number, number];
        const dist_m = haversineMeters(center!, coords);
        (f.properties as any) = { ...(f.properties || {}), dist_m, kind: "poi" };
        return f;
      })
      .sort((a, b) => ((a.properties as any).dist_m ?? 0) - ((b.properties as any).dist_m ?? 0))
      .slice(0, 5);

    const targetFeature: Feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: center },
      properties: { kind: "target", name: areaName || "Target" },
    };

    fc = {
      type: "FeatureCollection",
      features: [ ...(areaFeature ? [areaFeature] : []), targetFeature, ...points ],
    };
  }

  // Fallback path if we don't have tags/center or overpass empty → Nominatim search
  if (!fc) {
    // Try to bias Nominatim by center if we have one; otherwise guess from history name or SG
    const biasName = areaName || location || "Singapore";
    const simpleQ = [tags[0] ?? "", biasName, "Singapore"].filter(Boolean).join(" ").trim() || lastUserText;

    // If no center yet, geocode bias for fitting & target pin
    if (!center) {
      const bias = await geocodeOne(`${biasName}, Singapore`);
      if (bias) {
        center = [bias.lon, bias.lat];
        areaName = bias.display_name;
        if (bias.geojson) {
          areaFeature = {
            type: "Feature",
            geometry: bias.geojson,
            properties: { kind: "area", name: bias.display_name },
          };
        }
      }
    }

    const nom = await searchPlaces({ query: simpleQ, limit: 30 });
    const c = center || sticky?.center;
    const points = nom.features
      .filter((f) => f.geometry?.type === "Point")
      .map((f) => {
        const coords = (f.geometry as Point).coordinates as [number, number];
        const dist_m = c ? haversineMeters(c, coords) : Number.POSITIVE_INFINITY;
        (f.properties as any) = { ...(f.properties || {}), dist_m, kind: "poi" };
        return f;
      })
      .sort((a, b) => ((a.properties as any).dist_m ?? 0) - ((b.properties as any).dist_m ?? 0))
      .slice(0, 5);

    const features: Feature[] = [];
    if (areaFeature) features.push(areaFeature);
    if (c) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: c },
        properties: { kind: "target", name: areaName || "Target" },
      });
    }
    features.push(...points);

    fc = { type: "FeatureCollection", features };
  }

  // 6) Stream: give model full history + an inline instruction + exact FC to echo
  const fcString = JSON.stringify(fc ?? { type: "FeatureCollection", features: [] });

  const SYSTEM = `
You are Nika's location-intelligence assistant.

- If the user does not specify a location in this turn, infer it from the prior conversation (e.g., the last marked "target" area).
- Keep responses short (1–2 sentences).
- Then output EXACTLY the provided FeatureCollection inside a fenced \`\`\`geojson code block (do not modify it).
`.trim();

  // full chat history for context
  const history = convertToModelMessages(uiMessages);

  const messages: CoreMessage[] = [
    { role: "system", content: SYSTEM },
    ...history,
    {
      role: "system",
      content: `FeatureCollection to render:\n${fcString}`,
    },
  ];

  const result = await streamText({
    model: openai("gpt-5-mini"),
    messages,
    // maxOutputTokens can be set if you want to cap assistant verbosity:
    // maxOutputTokens: 600,
  });

  return result.toUIMessageStreamResponse();
}

/* ───────────────────────── helpers ───────────────────────── */

function extractLastUserText(ui: UIMessage[]): string {
  const lastUser = [...ui].reverse().find((m) => m.role === "user");
  if (!lastUser) return "";
  const c: any = lastUser.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p?.text === "string" ? p.text : "")).join(" ").trim();
  // AI SDK v5 also uses parts[] sometimes
  // @ts-ignore
  if (Array.isArray((lastUser as any).parts)) {
    // @ts-ignore
    return (lastUser as any).parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join(" ").trim();
  }
  return "";
}

/** Scan previous assistant messages for the last ```geojson block and derive a default target/area. */
function extractLastTargetFromHistory(ui: UIMessage[]): {
  center?: [number, number];
  name?: string;
  areaFeature?: Feature;
  radius?: number;
} | null {
  for (let i = ui.length - 1; i >= 0; i--) {
    const m = ui[i];
    if (m.role !== "assistant") continue;
    const text = messageTextFromUi(m);
    if (!text) continue;
    const fc = extractGeoJSON(text);
    if (!fc) continue;

    // target point (preferred)
    const target = fc.features.find((f: any) => f.geometry?.type === "Point" && f.properties?.kind === "target");
    if (target) {
      const center = (target.geometry as Point).coordinates as [number, number];
      const name = (target.properties as any)?.name || "";
      // area if exists
      const area = fc.features.find((f: any) => f.properties?.kind === "area") || null;
      const areaFeature = area ? (area as Feature) : undefined;

      // optional radius from area if available
      const radius = areaFeature ? approximateRadiusFromArea(areaFeature) : undefined;
      return { center, name, areaFeature, radius };
    }

    // else, derive center from polygon bbox
    const area = fc.features.find((f: any) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"));
    if (area) {
      const areaFeature = area as Feature;
      const [cx, cy] = centroidFromArea(areaFeature);
      const radius = approximateRadiusFromArea(areaFeature);
      const name = (areaFeature.properties as any)?.name || "";
      return { center: [cx, cy], name, areaFeature, radius };
    }
  }
  return null;
}

function messageTextFromUi(m: any): string {
  const c = m?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p?.text === "string" ? p.text : "")).join(" ");
  if (Array.isArray(m?.parts)) return m.parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join(" ");
  return "";
}

function extractGeoJSON(text: string): FeatureCollection | null {
  if (!text) return null;

  // Must be global (g) for matchAll; case-insensitive (i) so it catches ```geojson or ```json
  const re = /```(?:geo)?json\s*([\s\S]*?)```/gi;

  let last: string | null = null;
  for (const m of text.matchAll(re)) {
    // m[1] is the content inside the fenced block
    if (m && typeof m[1] === "string") last = m[1];
  }
  if (!last) return null;

  try {
    const parsed = JSON.parse(last);
    return parsed?.type === "FeatureCollection" ? (parsed as FeatureCollection) : null;
  } catch {
    return null;
  }
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

function centroidFromArea(area: Feature): [number, number] {
  const g = area.geometry as Polygon | MultiPolygon;
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const push = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  if (g.type === "Polygon") {
    g.coordinates.forEach((ring) => ring.forEach(([x, y]) => push(x, y)));
  } else {
    g.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(([x, y]) => push(x, y))));
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function approximateRadiusFromArea(area: Feature): number {
  const g = area.geometry as Polygon | MultiPolygon;
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const push = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  if (g.type === "Polygon") {
    g.coordinates.forEach((ring) => ring.forEach(([x, y]) => push(x, y)));
  } else {
    g.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach(([x, y]) => push(x, y))));
  }
  const center: [number, number] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const corner: [number, number] = [maxX, maxY];
  return haversineMeters(center, corner); // ~half-diagonal as radius
}
