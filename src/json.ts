function parseDelimited(text: string, open: "[" | "{", close: "]" | "}"): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf(open);
  const end = cleaned.lastIndexOf(close);
  if (start < 0 || end <= start) throw new Error(`LLM output contained no JSON ${open === "[" ? "array" : "object"}`);
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    throw new Error(`LLM output contained malformed JSON ${open === "[" ? "array" : "object"}: ${error}`);
  }
}

export function parseJsonArray<T = any>(text: string): T[] {
  const value = parseDelimited(text, "[", "]");
  if (!Array.isArray(value)) throw new Error("LLM output was not a JSON array");
  return value as T[];
}

export function parseJsonObject<T = any>(text: string): T {
  const value = parseDelimited(text, "{", "}");
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("LLM output was not a JSON object");
  }
  return value as T;
}
