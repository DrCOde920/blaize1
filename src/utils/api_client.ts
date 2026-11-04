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

export function attachLaunchTokenToRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): { input: RequestInfo | URL; init?: RequestInit } {
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
      return { input: new Request(input, modifiedInit), init: undefined };
    }
    return { input, init: modifiedInit };
  }

  return { input, init };
}

/**
 * Explicit API fetch wrapper that always attaches X-Blaize-Launch-Token on /api/* requests,
 * even in iframe environments where window.fetch is a non-configurable getter.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const prepared = attachLaunchTokenToRequest(input, init);
  return fetch(prepared.input, prepared.init);
}

/**
 * Initializes automatic launch token attachment on window.fetch for all relative or same-origin /api/* calls.
 * Safely handles environments where window.fetch is defined with only a getter (e.g. iframe shims).
 */
export function initClientApiInterceptor(): void {
  if (typeof window === 'undefined' || (window as any).__BLAIZE_INTERCEPTOR_INITIALIZED__) {
    return;
  }

  const rawFetch = window.fetch;
  if (typeof rawFetch !== 'function') {
    return;
  }
  const originalFetch = rawFetch.bind(window);

  const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const prepared = attachLaunchTokenToRequest(input, init);
    return originalFetch(prepared.input, prepared.init);
  };

  try {
    const desc = Object.getOwnPropertyDescriptor(window, 'fetch');
    if (!desc || desc.writable || typeof desc.set === 'function') {
      window.fetch = wrappedFetch;
    } else if (desc.configurable) {
      Object.defineProperty(window, 'fetch', {
        value: wrappedFetch,
        writable: true,
        configurable: true,
        enumerable: desc.enumerable ?? true,
      });
    }
  } catch {
    // When window.fetch is locked by an environment shim with a non-configurable getter,
    // rely on the early <head> interceptor and explicit apiFetch helper without throwing.
  }

  (window as any).__BLAIZE_INTERCEPTOR_INITIALIZED__ = true;
}

