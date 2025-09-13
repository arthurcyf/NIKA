import type { Feature, FeatureCollection, Geometry } from "geojson";

interface Args { query: string; city?: string; limit?: number }

export async function searchPlaces({ query, city, limit = 5 }: Args): Promise<FeatureCollection> {
  const q = [query, city].filter(Boolean).join(", ");
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("polygon_geojson", "1");
  url.searchParams.set("limit", String(limit));

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": `nika-li-chatbot (${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"})`,
      "Accept-Language": "en",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Nominatim error: ${res.status}`);
  const raw = await res.json();

  const features: Feature[] = raw.map((item: any) => {
    const geom: Geometry = item.geojson ?? {
      type: "Point",
      coordinates: [Number(item.lon), Number(item.lat)],
    };
    return {
      type: "Feature",
      geometry: geom,
      properties: {
        display_name: item.display_name,
        type: item.type,
        category: item.class,
        importance: item.importance,
        osm_id: item.osm_id,
        osm_type: item.osm_type,
        lat: item.lat,
        lon: item.lon,
      },
    };
  });

  return { type: "FeatureCollection", features };
}