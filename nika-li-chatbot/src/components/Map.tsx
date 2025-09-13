"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Map as MLMap, LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css"; // ensure popup/control styles are present
import type { FeatureCollection, Polygon, MultiPolygon, Point } from "geojson";

/** Reusable hover popup so we don't create/destroy many instances while moving */
let hoverPopup: maplibregl.Popup | null = null;
function showHover(map: MLMap, lngLat: maplibregl.LngLatLike, html: string) {
  if (!hoverPopup) {
    hoverPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      anchor: "top",
      offset: 8,
      className: "hover-popup",
    });
  }
  hoverPopup.setLngLat(lngLat).setHTML(html).addTo(map);
}
function hideHover() {
  if (hoverPopup) hoverPopup.remove();
}

export default function Map({ featureCollection }: { featureCollection: FeatureCollection | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [103.8198, 1.3521],
      zoom: 10,
    });
    mapRef.current = map;

    map.on("load", () => {
      ensureSourcesAndLayers(map);
      if (featureCollection) updateDataAndFit(map, featureCollection);
    });

    return () => {
      hideHover();
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    ensureSourcesAndLayers(map);
    updateDataAndFit(map, featureCollection ?? emptyFC());
  }, [featureCollection]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

/* ───────────────────────── helpers ───────────────────────── */

function ensureSourcesAndLayers(map: MLMap) {
  // source
  if (!map.getSource("places")) {
    map.addSource("places", { type: "geojson", data: emptyFC() });
  }

  // area fill
  if (!map.getLayer("places-fill")) {
    map.addLayer({
      id: "places-fill",
      type: "fill",
      source: "places",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "fill-color": "#c7d2fe", "fill-opacity": 0.4 }, // soft purple
    });
  }

  // area outline
  if (!map.getLayer("places-line")) {
    map.addLayer({
      id: "places-line",
      type: "line",
      source: "places",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: { "line-color": "#6366f1", "line-width": 2 },
    });
  }

  // target red pin
  if (!map.getLayer("target-point")) {
    map.addLayer({
      id: "target-point",
      type: "circle",
      source: "places",
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "kind"], "target"]],
      paint: {
        "circle-color": "#ef4444", // red-500
        "circle-radius": 7,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
  }

  // POIs blue pins
  if (!map.getLayer("poi-points")) {
    map.addLayer({
      id: "poi-points",
      type: "circle",
      source: "places",
      filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "kind"], "target"]],
      paint: {
        "circle-color": "#2563eb", // blue-600
        "circle-radius": 6,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
  }

  /* ── pointer cursor & hover tooltips ── */
  map.off("mouseenter", "poi-points", poiEnter as any);
  map.off("mouseleave", "poi-points", poiLeave as any);
  map.off("mousemove", "poi-points", poiMove as any);

  map.on("mouseenter", "poi-points", poiEnter as any);
  map.on("mouseleave", "poi-points", poiLeave as any);
  map.on("mousemove", "poi-points", poiMove as any);

  map.off("mouseenter", "target-point", targetEnter as any);
  map.off("mouseleave", "target-point", targetLeave as any);
  map.off("mousemove", "target-point", targetMove as any);

  map.on("mouseenter", "target-point", targetEnter as any);
  map.on("mouseleave", "target-point", targetLeave as any);
  map.on("mousemove", "target-point", targetMove as any);

  /* ── click popups (optional but nice) ── */
  map.off("click", "poi-points", onPoiClick as any);
  map.on("click", "poi-points", onPoiClick as any);

  map.off("click", "target-point", onTargetClick as any);
  map.on("click", "target-point", onTargetClick as any);
}

/* Hover handlers (show on enter & move, hide on leave) */
function poiEnter(e: any) {
  e.target.getCanvas().style.cursor = "pointer";
  const f = getTopFeatureAt(e.target, e.point, ["poi-points"]);
  if (!f) return;
  const coords = (f.geometry as Point).coordinates as [number, number];
  const p: any = f.properties || {};
  const name = p.name || p.display_name || "Place";
  showHover(e.target, coords, `<strong>${escapeHtml(name)}</strong>`);
}
function poiMove(e: any) {
  const f = getTopFeatureAt(e.target, e.point, ["poi-points"]);
  if (!f) return;
  const coords = (f.geometry as Point).coordinates as [number, number];
  const p: any = f.properties || {};
  const name = p.name || p.display_name || "Place";
  showHover(e.target, coords, `<strong>${escapeHtml(name)}</strong>`);
}
function poiLeave(e: any) {
  e.target.getCanvas().style.cursor = "";
  hideHover();
}

function targetEnter(e: any) {
  e.target.getCanvas().style.cursor = "pointer";
  const f = getTopFeatureAt(e.target, e.point, ["target-point"]);
  if (!f) return;
  const coords = (f.geometry as Point).coordinates as [number, number];
  const p: any = f.properties || {};
  const name = p.name || "Target";
  showHover(e.target, coords, `<strong>${escapeHtml(name)}</strong>`);
}
function targetMove(e: any) {
  const f = getTopFeatureAt(e.target, e.point, ["target-point"]);
  if (!f) return;
  const coords = (f.geometry as Point).coordinates as [number, number];
  const p: any = f.properties || {};
  const name = p.name || "Target";
  showHover(e.target, coords, `<strong>${escapeHtml(name)}</strong>`);
}
function targetLeave(e: any) {
  e.target.getCanvas().style.cursor = "";
  hideHover();
}

/* Click handlers for richer details */
function onPoiClick(e: any) {
  const f = e.features?.[0] || getTopFeatureAt(e.target, e.point, ["poi-points"]);
  if (!f) return;
  const coords = (f.geometry as Point).coordinates as [number, number];
  const p: any = f.properties || {};
  const name = p.name || p.display_name || "Place";
  const amen = p.amenity ? `<div>Amenity: ${escapeHtml(p.amenity)}</div>` : "";
  new maplibregl.Popup({ closeButton: true, closeOnClick: true })
    .setLngLat(coords)
    .setHTML(`<strong>${escapeHtml(name)}</strong>${amen}`)
    .addTo(e.target);
}
function onTargetClick(e: any) {
  const f = e.features?.[0] || getTopFeatureAt(e.target, e.point, ["target-point"]);
  if (!f) return;
  const coords = (f.geometry as Point).coordinates as [number, number];
  const p: any = f.properties || {};
  const name = p.name || "Target";
  new maplibregl.Popup({ closeButton: true, closeOnClick: true })
    .setLngLat(coords)
    .setHTML(`<strong>${escapeHtml(name)}</strong>`)
    .addTo(e.target);
}

/* Data + fit */
function updateDataAndFit(map: MLMap, fc: FeatureCollection) {
  const src = map.getSource("places") as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  src.setData(fc);

  const bounds = new maplibregl.LngLatBounds();
  let hasAny = false;
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    hasAny = true;
    if (g.type === "Point") {
      bounds.extend(g.coordinates as [number, number]);
    } else if (g.type === "Polygon" || g.type === "MultiPolygon") {
      getPolyCoords(g).forEach((c) => bounds.extend(c));
    }
  }
  if (hasAny) map.fitBounds(bounds as unknown as LngLatBoundsLike, { padding: 40, duration: 600 });
}

/* Utilities */
function getTopFeatureAt(map: MLMap, point: { x: number; y: number }, layers: string[]) {
  const feats = map.queryRenderedFeatures(point, { layers });
  return feats && feats.length ? feats[0] : null;
}

function getPolyCoords(g: Polygon | MultiPolygon): [number, number][] {
  const out: [number, number][] = [];
  if (g.type === "Polygon") g.coordinates.forEach((ring) => ring.forEach((c) => out.push(c as [number, number])));
  if (g.type === "MultiPolygon") g.coordinates.forEach((poly) => poly.forEach((ring) => ring.forEach((c) => out.push(c as [number, number]))));
  return out;
}

function emptyFC(): FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m] as string));
}