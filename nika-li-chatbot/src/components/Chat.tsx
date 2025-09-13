"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";

export function Chat({ onGeoJSON }: { onGeoJSON: (fc: FeatureCollection) => void }) {
  const { messages, sendMessage, status } = useChat({
    api: "/api/chat",
    onFinish({ message }) {
      // On final token: extract GeoJSON and send to map
      const text = messageText(message);
      const fc = extractGeoJSON(text);
      if (fc) {
        setLastFC(fc);
        onGeoJSON(fc);
      }
    },
    onError: console.error,
  });

  const [input, setInput] = useState("");
  const [lastFC, setLastFC] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    if (messages.length === 0) {
      setInput("Find team-friendly cafes near One-North, Singapore, and show them on the map.");
    }
  }, [messages.length]);

  // Build a render-ready list where assistant messages have GeoJSON removed
  const renderedMessages = useMemo(() => {
    return messages
      .map((m) => {
        const raw = messageText(m);
        const text =
          m.role === "assistant" ? stripForDisplay(raw) : raw?.trim();

        return { id: m.id, role: m.role as "user" | "assistant", text: text ?? "" };
      })
      // Skip bubbles that end up empty (e.g., assistant message that only contained GeoJSON)
      .filter((m) => m.text.length > 0);
  }, [messages]);

  // Derive a tidy list from the last FeatureCollection (points only)
  const places = useMemo(() => {
    if (!lastFC) return [];
    return lastFC.features
      .filter((f) => f?.geometry?.type === "Point" && (f.properties as any)?.kind !== "target")
      .map((f) => {
        const p: any = f.properties || {};
        return {
          id:
            p.id ??
            `${(f.geometry as any)?.coordinates?.join(",")}-${Math.random().toString(36).slice(2, 8)}`,
          name: p.name || p.display_name || "Unnamed place",
          amenity: p.amenity,
          cuisine: p.cuisine,
          opening_hours: p.opening_hours,
          website: p.website,
        };
      })
      .slice(0, 5);
  }, [lastFC]);

  const areaName = useMemo(() => {
    if (!lastFC) return "";
    const area = lastFC.features.find((f: any) => f?.properties?.kind === "area");
    return (area?.properties as any)?.name || "";
  }, [lastFC]);

  return (
    <div className="chat">
      <div className="messages">
        {renderedMessages.map((m) => {
          const roleClass = m.role === "user" ? "user" : "assistant";
          return (
            <div key={m.id} className={`msgRow ${roleClass}`}>
              <div style={{ maxWidth: "100%" }}>
                <div className="meta">{m.role === "user" ? "You" : "Bot"}</div>
                <div
                  className={`bubble ${roleClass}`}
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                  }}
                >
                  {m.text}
                </div>
              </div>
            </div>
          );
        })}

        {/* Nicely formatted places list */}
        {lastFC && (
          <div className="placesPanel" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              {areaName ? `${areaName}: ` : ""}Places found ({places.length})
            </div>
            {places.length === 0 ? (
              <div style={{ color: "#666" }}>
                No places found. Try a different area or tag (e.g., “cafes near NTU”).
              </div>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {places.map((p) => (
                  <li key={p.id} className="placeItem">
                    <div className="placeName">{p.name}</div>
                    <div className="placeSub">
                      {p.amenity ? `Amenity: ${p.amenity}` : null}
                      {p.cuisine ? ` · Cuisine: ${p.cuisine}` : null}
                      {p.opening_hours ? ` · Hours: ${p.opening_hours}` : null}
                    </div>
                    {p.website && (
                      <div style={{ fontSize: 12 }}>
                        <a href={ensureHttp(p.website)} target="_blank" rel="noreferrer">
                          {p.website}
                        </a>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div style={{ fontSize: 12, color: "#888", marginTop: 6 }}>
              (These are also plotted on the map.)
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, color: "#666", marginTop: 12 }}>
          Tip: “Recommend lunch spots near NTU with vegetarian options and show them on the map.”
        </div>
      </div>

      <form
        className="inputRow"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || status !== "ready") return;
          sendMessage({ text: input });
          setInput("");
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={status !== "ready"}
          placeholder="Ask for places…"
          aria-label="Message"
        />
        <button type="submit" disabled={status !== "ready"}>
          Send
        </button>
      </form>
    </div>
  );
}

/* ---------- helpers ---------- */

function messageText(m: any): string {
  // AI SDK v5 messages come with parts[]
  if (!m?.parts) return "";
  return m.parts.map((p: any) => (p.type === "text" ? p.text : "")).join("");
}

/**
 * Remove any fenced ```geojson / ```json blocks from assistant text,
 * including *partial* streaming fences without a closing ``` yet.
 * Also strip generic ```…``` blocks as a fallback.
 */
function stripForDisplay(text: string): string {
  if (!text) return "";

  let out = text;

  // Remove complete geojson/json fenced blocks (case-insensitive)
  out = out.replace(/```(?:geo)?json[\s\S]*?```/gi, "");

  // Remove any open geojson/json fence to the end (streaming partial)
  out = out.replace(/```(?:geo)?json[\s\S]*$/gi, "");

  // Fallback: remove any other fenced block (helps if model says ```map or similar)
  out = out.replace(/```[\s\S]*?```/g, "");

  return out.trim();
}

function extractGeoJSON(text: string): FeatureCollection | null {
  // Take the last fenced geojson/json block, if any
  const matches = Array.from(text.matchAll(/```(?:geo)?json\s*([\s\S]*?)```/gi));
  if (!matches.length) return null;
  try {
    const parsed = JSON.parse(matches[matches.length - 1][1]);
    return parsed?.type === "FeatureCollection" ? (parsed as FeatureCollection) : null;
  } catch {
    return null;
  }
}

function ensureHttp(url: string) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `http://${url}`;
}