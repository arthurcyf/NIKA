"use client";
import { useEffect, useRef } from "react";
import maplibregl, { Map as MLMap, LngLatBoundsLike } from "maplibre-gl";
import type { FeatureCollection, Polygon, MultiPolygon } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";

export default function Map({ featureCollection }: { featureCollection: FeatureCollection | null }) {
  const mapRef = useRef<MLMap | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const loadedRef = useRef(false);

  // Create map once
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [103.8198, 1.3521], // Singapore
      zoom: 10,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

    map.on("load", () => {
      ensureSourcesAndLayers(map);
      loadedRef.current = true;
    });

    mapRef.current = map;

    // Cleanup for StrictMode re-mounts
    return () => {
      loadedRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Update data whenever featureCollection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      ensureSourcesAndLayers(map);
      const src = map.getSource("places") as maplibregl.GeoJSONSource | undefined;
      const data = (featureCollection ??
        ({ type: "FeatureCollection", features: [] } as FeatureCollection));
      if (src) src.setData(data);

      // Fit bounds to visible features
      if (featureCollection && featureCollection.features.length) {
        const bounds = new maplibregl.LngLatBounds();
        featureCollection.features.forEach((f) => {
          if (f.geometry.type === "Point") {
            // @ts-ignore
            const [lng, lat] = f.geometry.coordinates;
            bounds.extend([lng, lat]);
          } else if (f.geometry.type === "Polygon") {
            (f.geometry as Polygon).coordinates.flat().forEach(([lng, lat]) => bounds.extend([lng, lat]));
          } else if (f.geometry.type === "MultiPolygon") {
            (f.geometry as MultiPolygon).coordinates.flat(2).forEach(([lng, lat]) => bounds.extend([lng, lat]));
          }
        });
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds as unknown as LngLatBoundsLike, { padding: 40, duration: 500 });
        }
      }
    };

    if (loadedRef.current) {
      apply();
    } else {
      // If style not loaded yet (first mount / StrictMode), wait once
      map.once("load", apply);
    }
  }, [featureCollection]);

  return <div ref={containerRef} style={{ width: "100%", height: "100vh" }} />;
}

// Idempotently add source/layers if missing
function ensureSourcesAndLayers(map: MLMap) {
  if (!map.getSource("places")) {
    map.addSource("places", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  if (!map.getLayer("places-fill")) {
  map.addLayer({
    id: "places-fill",
    type: "fill",
    source: "places",
    paint: { "fill-opacity": 0.3 },
    filter: ["==", ["geometry-type"], "Polygon"],
  });
}

  if (!map.getLayer("places-line")) {
    map.addLayer({
      id: "places-line",
      type: "line",
      source: "places",
      paint: { "line-width": 2 },
    });
  }

  if (!map.getLayer("places-points")) {
    map.addLayer({
      id: "places-points",
      type: "circle",
      source: "places",
      paint: { "circle-radius": 5 },
      filter: ["==", "$type", "Point"],
    });
  }
}
