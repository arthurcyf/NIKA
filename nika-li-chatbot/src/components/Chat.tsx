"use client";
import { useChat } from "@ai-sdk/react";
import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";

export function Chat({ onGeoJSON }: { onGeoJSON: (fc: FeatureCollection) => void }) {
  const { messages, sendMessage, status } = useChat({
    api: "/api/chat",
    onFinish({ message }) {
      const text = messageText(message);
      const fc = extractGeoJSON(text);
      if (fc) onGeoJSON(fc);
    },
    onError: console.error,
  });

  const [input, setInput] = useState("");

  useEffect(() => {
    if (messages.length === 0) {
      setInput("Find team-friendly cafes near One-North, Singapore, and show them on the map.");
    }
  }, [messages.length]);

  return (
    <div className="chat">
      <div className="messages">
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: 10 }}>
            <div style={{ fontWeight: 600 }}>{m.role === "user" ? "You" : "Bot"}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>
              {m.parts?.map((p: any, i: number) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
            </div>
          </div>
        ))}
        <div style={{ fontSize: 12, color: "#666" }}>
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

function messageText(m: any): string {
  if (!m?.parts) return "";
  return m.parts.map((p: any) => (p.type === "text" ? p.text : "")).join("");
}

function extractGeoJSON(text: string): FeatureCollection | null {
  const matches = Array.from(text.matchAll(/```geojson\s*([\s\S]*?)```/g));
  if (!matches.length) return null;
  const last = matches[matches.length - 1][1];
  try {
    const parsed = JSON.parse(last);
    if (parsed?.type === "FeatureCollection") return parsed as FeatureCollection;
  } catch {}
  return null;
}