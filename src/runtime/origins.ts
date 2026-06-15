const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function originToMatchPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export function uniqueMatchPatterns(origins: readonly string[]): string[] {
  return [...new Set(origins.map(originToMatchPattern))].sort();
}

