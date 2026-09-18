export function parseJsonObject<T>(text: string): T {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^\`\`\`(?:json)?\s*/i, '')
    .replace(/\s*\`\`\`$/, '')
    .trim();

  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error('Model did not return a JSON object: ' + trimmed.slice(0, 500));
  }

  return JSON.parse(withoutFence.slice(start, end + 1)) as T;
}
