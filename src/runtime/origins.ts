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

// Chrome host permissions cannot encode a port, so the granted pattern is
// host-wide (e.g. http://localhost/*). toLocal compensates by gating on the
// exact full origin (scheme + host + port) in storage and in the content
// script, so http://localhost:4173 and http://localhost:4174 stay independent
// even though they share one host permission.
export function originToMatchPattern(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

export function uniqueMatchPatterns(origins: readonly string[]): string[] {
  return [...new Set(origins.map(originToMatchPattern))].sort();
}
