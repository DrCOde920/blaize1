/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Client API Helper & Launch Token Interceptor (`src/utils/api_client.ts`)
 * - Retrieves `X-Blaize-Launch-Token` from the same-origin page load
 * - Transparently equips client `/api/*` requests with the launch token
 */

let clientLaunchToken = '';

export function getLaunchToken(): string {
  if (clientLaunchToken) return clientLaunchToken;

  if (typeof window !== 'undefined') {
    // 1. Check window.__BLAIZE_LAUNCH_TOKEN__ injected by server
    const winToken = (window as any).__BLAIZE_LAUNCH_TOKEN__;
    if (typeof winToken === 'string' && winToken) {
      clientLaunchToken = winToken;
      return clientLaunchToken;
    }

    // 2. Check <meta name="blaize-launch-token"> injected by server
    const meta = document.querySelector('meta[name="blaize-launch-token"]');
    if (meta) {
      const val = meta.getAttribute('content');
      if (val && !val.startsWith('%')) {
        clientLaunchToken = val;
        return clientLaunchToken;
      }
    }
  }

  return '';
}

export function setLaunchToken(token: string): void {
  clientLaunchToken = token.trim();
  if (typeof window !== 'undefined') {
    (window as any).__BLAIZE_LAUNCH_TOKEN__ = clientLaunchToken;
  }
}

/**
 * Initializes automatic launch token attachment on window.fetch for all relative or same-origin /api/* calls.
 */
export function initClientApiInterceptor(): void {
  if (typeof window === 'undefined' || (window as any).__BLAIZE_INTERCEPTOR_INITIALIZED__) {
    return;
  }

  const originalFetch = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let urlString = '';
    if (typeof input === 'string') {
      urlString = input;
    } else if (input instanceof URL) {
      urlString = input.toString();
    } else if (input && typeof input === 'object' && 'url' in input) {
      urlString = input.url;
    }

    // Intercept /api/ calls
    if (urlString.startsWith('/api') || urlString.includes('/api/')) {
      const token = getLaunchToken();
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : {}));

      if (token && !headers.has('x-blaize-launch-token')) {
        headers.set('X-Blaize-Launch-Token', token);
      }

      const modifiedInit: RequestInit = {
        ...init,
        headers,
      };

      if (input instanceof Request) {
        return originalFetch(new Request(input, modifiedInit));
      }
      return originalFetch(input, modifiedInit);
    }

    return originalFetch(input, init);
  };

  (window as any).__BLAIZE_INTERCEPTOR_INITIALIZED__ = true;
}
