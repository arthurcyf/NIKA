export interface GeocodeHit {
  lat: number;
  lon: number;
  display_name: string;
  boundingbox?: [string, string, string, string]; // [lat_min, lat_max, lon_min, lon_max]
  geojson?: any;
}

export async function geocodeOne(q: string): Promise<GeocodeHit | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("polygon_geojson", "1");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "nika-li-chatbot (localhost)",
      "Accept-Language": "en",
    },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const it = arr[0];
  return {
    lat: Number(it.lat),
    lon: Number(it.lon),
    display_name: it.display_name,
    boundingbox: it.boundingbox,
    geojson: it.geojson,
  };
}

export function estimateRadiusMeters(hit: GeocodeHit | null): number {
  if (!hit?.boundingbox) return 800; // default ~0.8km
  const [latMinS, latMaxS, lonMinS, lonMaxS] = hit.boundingbox;
  const latMin = Number(latMinS), latMax = Number(latMaxS);
  const lonMin = Number(lonMinS), lonMax = Number(lonMaxS);
  // quick haversine-ish estimate using 111km per degree
  const dLat = (latMax - latMin) * 111_000;
  const dLon = (lonMax - lonMin) * 111_000 * Math.cos(((latMax + latMin) / 2) * Math.PI / 180);
  const diag = Math.sqrt(dLat * dLat + dLon * dLon);
  return Math.max(400, Math.min(2000, Math.round(diag / 2))); // 0.4–2.0 km
}