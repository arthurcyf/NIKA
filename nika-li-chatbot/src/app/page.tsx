"use client";
import { useCallback, useState } from "react";
import type { FeatureCollection } from "geojson";
import { Chat } from "@/components/Chat";
import Map from "@/components/Map";

export default function Page() {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const handleGeoJSON = useCallback((fc: FeatureCollection) => setGeojson(fc), []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Nika LI Chatbot</h1>
          <span className="badge">gpt-5-mini</span>
        </div>

        <Chat onGeoJSON={handleGeoJSON} />
      </aside>

      <main className="mapWrap">
        <Map featureCollection={geojson} />
      </main>
    </div>
  );
}
