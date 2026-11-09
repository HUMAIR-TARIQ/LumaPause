/** Content Security Policy shared by the Vite HTML transform and Electron headers. */
export function contentSecurityPolicy(development: boolean, meta = false): string {
  // frame-ancestors is ignored when delivered through a <meta> element, so the
  // inline development policy omits it. The response header still carries it.
  const shared = development
    ? [
        "default-src 'self'",
        // Vite's dev client and React refresh use an inline bootstrap.
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob: mediastream:",
        "worker-src 'self' blob:",
        "connect-src 'self' ws://localhost:5173 http://localhost:5173 ws://127.0.0.1:5173 http://127.0.0.1:5173",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ]
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob: mediastream:",
        "worker-src 'self' blob:",
        "connect-src 'self'",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ];
  if (!meta) shared.push("frame-ancestors 'none'");
  return shared.join('; ');
}
