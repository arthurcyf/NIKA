const TAG_MAP: Record<string, string[]> = {
  cafe: ["cafe", "cafes", "coffee", "coffee shop", "espresso"],
  restaurant: ["restaurant", "restaurants", "lunch", "dinner", "food", "eatery"],
  bar: ["bar", "bars", "pub", "drinks"],
  park: ["park", "parks", "green space", "garden"],
};

export function parseQuery(userText: string): { tags: string[]; location?: string } {
  const text = String(userText || "").toLowerCase();

  // tags
  const tags = new Set<string>();
  for (const [tag, words] of Object.entries(TAG_MAP)) {
    if (words.some((w) => new RegExp(`\\b${escapeReg(w)}\\b`, "i").test(text))) {
      tags.add(tag);
    }
  }
  if (tags.size === 0) {
    // heuristic: if the user says "find X" and X is plural, assume "restaurant"
    if (/\blunch\b|\bfood\b/i.test(text)) tags.add("restaurant");
    if (/\bcafe|coffee/i.test(text)) tags.add("cafe");
  }

  // location after near|around|in ...
  const near =
    text.match(/\bnear\b\s+([^,.;]+)/i) ||
    text.match(/\baround\b\s+([^,.;]+)/i) ||
    text.match(/\bin\b\s+([^,.;]+)/i);
  let location = near?.[1]?.trim();
  // normalize common spellings
  if (location) {
    location = location.replace(/\bone\s*[-\s]?north\b/i, "one-north");
  }

  return { tags: Array.from(tags), location };
}

function escapeReg(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
