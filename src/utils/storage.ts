export function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function generateSessionName(firstMessage: string): string {
  const maxLen = 30;
  const cleaned = firstMessage.replace(/\n/g, ' ').trim();
  return truncateText(cleaned, maxLen);
}