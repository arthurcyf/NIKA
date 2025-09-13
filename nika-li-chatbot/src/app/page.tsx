"use client";
import dynamic from "next/dynamic";
import { Chat } from "@/components/Chat";
import { useState, useCallback } from "react";
import type { FeatureCollection } from "geojson";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

export default function Page() {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);

  // stable function so Chat effects don't re-trigger on every render
  const handleGeoJSON = useCallback((fc: FeatureCollection) => {
    setGeojson(fc);
  }, []);

  return (
    <div className="app">
      <aside className="sidebar">
        <div
          style={{
            padding: "12px",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <h3 style={{ margin: 0 }}>Nika LI Chatbot</h3>
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
