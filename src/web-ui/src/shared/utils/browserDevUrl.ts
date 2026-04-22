const DEV_APP_PORT = '1422';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function isBundledAppDevUrl(value: string | null | undefined): boolean {
  if (import.meta.env.DEV || !value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      LOOPBACK_HOSTS.has(parsed.hostname) &&
      parsed.port === DEV_APP_PORT
    );
  } catch {
    return false;
  }
}

export function resolveRestoredBrowserUrl(
  value: string | null | undefined,
  fallbackUrl: string,
): string {
  if (!value) {
    return fallbackUrl;
  }

  return isBundledAppDevUrl(value) ? fallbackUrl : value;
}
