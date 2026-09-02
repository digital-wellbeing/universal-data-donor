import React, { useEffect, useRef } from 'react';

/**
 * Renders a Cloudflare Turnstile widget and reports its token via `onToken`.
 *
 * The Turnstile script is loaded once in public/index.html. This component
 * waits for `window.turnstile` to be available, then explicitly renders the
 * widget so it works reliably inside React's lifecycle. The token is single-use
 * and expires (~5 min); on expiry/error we report an empty token so the caller
 * can disable submission until the user re-solves.
 *
 * @param {string} sitekey - Cloudflare Turnstile site key
 * @param {(token: string) => void} onToken - called with the token ('' when cleared)
 * @param {string} [action] - action label echoed back by siteverify (the server
 *   can require it to match), 1–32 chars of [a-z0-9_-]. Defaults to 'donate'.
 */
export default function TurnstileWidget({ sitekey, onToken, action = 'donate' }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let pollTimer = null;

    const tryRender = () => {
      if (cancelled) return;
      if (window.turnstile && containerRef.current && widgetIdRef.current === null) {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey,
          action,
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        });
      } else if (!window.turnstile) {
        // Script not ready yet — poll briefly until it loads.
        pollTimer = setTimeout(tryRender, 200);
      }
    };

    tryRender();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      try {
        if (widgetIdRef.current !== null && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
        }
      } catch (e) {
        /* ignore */
      }
      widgetIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitekey, action]);

  return <div ref={containerRef} />;
}
