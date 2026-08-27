export function normalizeImageGenerationBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Image generation Base URL must be a valid HTTP or HTTPS URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Image generation Base URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Image generation Base URL must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new Error("Image generation Base URL must not contain a query string or fragment.");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}
