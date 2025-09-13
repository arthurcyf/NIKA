import type { Feature, FeatureCollection } from "geojson";

/**
 * Simple Overpass around-search for amenity tags near a [lon, lat] center.
 * Returns Point FeatureCollection (nodes only for simplicity and speed).
 */
export async function nearbyAmenities({
  center,
  radius,
  tags,
  limit,
}: {
  center: [number, number]; // [lon, lat]
  radius: number;           // meters
  tags: string[];           // e.g., ['cafe','restaurant','bar']
  limit?: number;
}): Promise<FeatureCollection> {
  const [lon, lat] = center;

  // Build OR filters: (node["amenity"="cafe"];node["amenity"="restaurant"];...)
  const ors = tags
    .map((t) => `node["amenity"="${escapeTag(t)}"](around:${Math.max(1, Math.floor(radius))},${lat},${lon});`)
    .join("\n");

  const query = `
    [out:json][timeout:25];
    (
      ${ors}
    );
    out center ${limit ? `qt ${limit}` : "qt"};
  `.trim();

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams({ data: query }).toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Overpass error: ${res.status}`);
  const data = await res.json();

  const features: Feature[] = (data.elements || [])
    .filter((el: any) => el.type === "node")
    .map((el: any) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [el.lon, el.lat] },
      properties: {
        id: el.id,
        name: el.tags?.name,
        amenity: el.tags?.amenity,
        // Optional helpful metadata:
        opening_hours: el.tags?.opening_hours,
        cuisine: el.tags?.cuisine,
        website: el.tags?.website,
      },
    }));

  return { type: "FeatureCollection", features };
}

function escapeTag(s: string) {
  // Basic escape for quotes in Overpass tag value
  return s.replace(/"/g, '\\"');
}