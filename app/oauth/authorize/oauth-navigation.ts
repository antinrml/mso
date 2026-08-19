export type OAuthLocation = Pick<Location, "replace">;

/** Force the OAuth callback into the visible top-level browsing context. */
export function followOAuthRedirect(raw: string, location: OAuthLocation = window.location): void {
  const url = new URL(raw);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("OAuth redirect must use https or a loopback http address");
  }
  location.replace(url.toString());
}
