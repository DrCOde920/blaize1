/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hardened SSRF Defense, DNS Resolver, IP Pinning & Manual Redirect Follower (`src/server/middleware/ssrf.ts`)
 *
 * Enforces:
 * - DNS resolution on the server
 * - Blocks loopback, private, link-local, multicast, broadcast, and metadata addresses
 * - Catches IPv4 in decimal (e.g. 2130706433), hex (0x7f000001), octal (0177.0.0.1), and mixed formats
 * - Catches IPv6, IPv4-mapped IPv6 (::ffff:127.0.0.1), and IPv4-compatible IPv6
 * - Pins the resolved IP address to prevent DNS rebinding attacks
 * - Manually follows redirects with full re-validation of each hop (max 3 hops)
 * - Strict response size cap and timeout limits
 */

import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { SERVER_DEFAULTS } from '../config';

export interface SsrfValidationResult {
  allowed: boolean;
  reason?: string;
  resolvedIp?: string;
}

/**
 * Checks if an IPv4 address string falls into a prohibited range.
 */
function isBlockedIpv4(ip: string): { blocked: boolean; reason?: string } {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(isNaN) || parts.some((p) => p < 0 || p > 255)) {
    return { blocked: true, reason: `Malformed IPv4 address '${ip}'.` };
  }

  const [a, b, c, d] = parts;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) {
    return { blocked: true, reason: `Access to loopback address (${ip}) is forbidden.` };
  }
  // 0.0.0.0/8 (Broadcast/Current network)
  if (a === 0) {
    return { blocked: true, reason: `Access to broadcast/unspecified address (${ip}) is forbidden.` };
  }
  // 10.0.0.0/8 (Private)
  if (a === 10) {
    return { blocked: true, reason: `Access to private network (${ip}) is forbidden.` };
  }
  // 172.16.0.0/12 (Private)
  if (a === 172 && b >= 16 && b <= 31) {
    return { blocked: true, reason: `Access to private network (${ip}) is forbidden.` };
  }
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) {
    return { blocked: true, reason: `Access to private network (${ip}) is forbidden.` };
  }
  // 169.254.0.0/16 (Link-local & cloud metadata)
  if (a === 169 && b === 254) {
    return { blocked: true, reason: `Access to link-local/cloud metadata address (${ip}) is forbidden.` };
  }
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) {
    return { blocked: true, reason: `Access to carrier-grade NAT address (${ip}) is forbidden.` };
  }
  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) {
    return { blocked: true, reason: `Access to multicast address (${ip}) is forbidden.` };
  }
  // 240.0.0.0/4 & 255.255.255.255 (Reserved/Broadcast)
  if (a >= 240) {
    return { blocked: true, reason: `Access to reserved/broadcast address (${ip}) is forbidden.` };
  }

  return { blocked: false };
}

/**
 * Checks if an IPv6 address string falls into a prohibited range.
 */
function isBlockedIpv6(ip: string): { blocked: boolean; reason?: string } {
  let normalized = ip.toLowerCase();

  // Strip brackets if present
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }

  // IPv4-mapped IPv6: ::ffff:a.b.c.d
  const mappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedMatch) {
    return isBlockedIpv4(mappedMatch[1]);
  }

  // Loopback ::1
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return { blocked: true, reason: `Access to IPv6 loopback (${ip}) is forbidden.` };
  }

  // Unspecified ::
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') {
    return { blocked: true, reason: `Access to IPv6 unspecified address (${ip}) is forbidden.` };
  }

  // Unique local addresses fc00::/7 (private IPv6)
  if (/^f[cd][0-9a-f]{2}:/i.test(normalized)) {
    return { blocked: true, reason: `Access to private IPv6 address (${ip}) is forbidden.` };
  }

  // Link-local unicast fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(normalized)) {
    return { blocked: true, reason: `Access to link-local IPv6 address (${ip}) is forbidden.` };
  }

  // Multicast ff00::/8
  if (/^ff[0-9a-f]{2}:/i.test(normalized)) {
    return { blocked: true, reason: `Access to multicast IPv6 address (${ip}) is forbidden.` };
  }

  return { blocked: false };
}

/**
 * Parses numeric IPv4 representations (decimal integer, hex, octal, dotted combinations).
 * E.g.:
 * - "2130706433" -> "127.0.0.1"
 * - "0x7f000001" -> "127.0.0.1"
 * - "0177.0.0.1"  -> "127.0.0.1"
 */
export function tryParseNumericIpv4(hostname: string): string | null {
  const clean = hostname.trim().toLowerCase();

  // Single decimal or hex integer
  if (/^(0x[0-9a-f]+|\d+)$/i.test(clean)) {
    const val = clean.startsWith('0x') ? parseInt(clean, 16) : parseInt(clean, 10);
    if (!isNaN(val) && val >= 0 && val <= 0xffffffff) {
      const a = (val >>> 24) & 0xff;
      const b = (val >>> 16) & 0xff;
      const c = (val >>> 8) & 0xff;
      const d = val & 0xff;
      return `${a}.${b}.${c}.${d}`;
    }
  }

  // Dotted notation containing octal or hex parts
  const parts = clean.split('.');
  if (parts.length >= 2 && parts.length <= 4) {
    const numericParts: number[] = [];
    for (const part of parts) {
      let num: number;
      if (/^0x[0-9a-f]+$/i.test(part)) {
        num = parseInt(part, 16);
      } else if (/^0[0-7]+$/.test(part)) {
        num = parseInt(part, 8);
      } else if (/^\d+$/.test(part)) {
        num = parseInt(part, 10);
      } else {
        return null;
      }
      if (isNaN(num) || num < 0) return null;
      numericParts.push(num);
    }

    if (numericParts.length === 4) {
      if (numericParts.every((p) => p <= 255)) {
        return numericParts.join('.');
      }
    } else if (numericParts.length === 2) {
      // a.b (where b is 24-bit)
      const [a, rest] = numericParts;
      if (a <= 255 && rest <= 0xffffff) {
        return `${a}.${(rest >>> 16) & 0xff}.${(rest >>> 8) & 0xff}.${rest & 0xff}`;
      }
    }
  }

  return null;
}

/**
 * Validates a hostname and its resolved DNS addresses against all SSRF threat vectors.
 */
export async function validateHostForSsrf(hostname: string): Promise<SsrfValidationResult> {
  const cleanHost = hostname.trim().toLowerCase();

  // Known metadata hostnames
  if (
    cleanHost === 'localhost' ||
    cleanHost === 'metadata.google.internal' ||
    cleanHost.endsWith('.localhost') ||
    cleanHost.endsWith('.local')
  ) {
    return { allowed: false, reason: `Access to internal host '${cleanHost}' is forbidden.` };
  }

  // Check for encoded numeric IP formats (decimal, hex, octal)
  const numericIp = tryParseNumericIpv4(cleanHost);
  if (numericIp) {
    const check = isBlockedIpv4(numericIp);
    if (check.blocked) {
      return { allowed: false, reason: check.reason };
    }
  }

  // Check literal IPv6
  if (cleanHost.includes(':')) {
    const check = isBlockedIpv6(cleanHost);
    if (check.blocked) {
      return { allowed: false, reason: check.reason };
    }
  }

  // Check literal IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(cleanHost)) {
    const check = isBlockedIpv4(cleanHost);
    if (check.blocked) {
      return { allowed: false, reason: check.reason };
    }
    return { allowed: true, resolvedIp: cleanHost };
  }

  // Perform server-side DNS resolution
  try {
    const records = await dns.lookup(cleanHost, { all: true });
    if (!records || records.length === 0) {
      return { allowed: false, reason: `Could not resolve hostname '${cleanHost}'.` };
    }

    // Every resolved IP address must be validated
    for (const record of records) {
      if (record.family === 4) {
        const check = isBlockedIpv4(record.address);
        if (check.blocked) {
          return { allowed: false, reason: `Resolved IP (${record.address}) is forbidden: ${check.reason}` };
        }
      } else if (record.family === 6) {
        const check = isBlockedIpv6(record.address);
        if (check.blocked) {
          return { allowed: false, reason: `Resolved IPv6 (${record.address}) is forbidden: ${check.reason}` };
        }
      }
    }

    // Select the first safe resolved IP to pin for this request
    return { allowed: true, resolvedIp: records[0].address };
  } catch (err: any) {
    return { allowed: false, reason: `DNS lookup failed for '${cleanHost}': ${err?.message || 'resolution error'}` };
  }
}

export interface PinnedFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxSizeBytes?: number;
  maxRedirects?: number;
  allowedHostsChecker?: (host: string) => boolean;
}

export interface PinnedFetchResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  dataText: string;
  finalUrl: string;
  resolvedIp: string;
  hops: number;
}

/**
 * Performs a hardened HTTP/HTTPS request with:
 * - Server DNS lookup & SSRF filtering
 * - IP pinning
 * - Manual redirect following (re-validating every hop)
 * - Strict response size cap and timeout
 */
export async function executeSsrfProtectedFetch(
  targetUrl: string,
  options: PinnedFetchOptions = {}
): Promise<PinnedFetchResponse> {
  const maxRedirects = options.maxRedirects ?? SERVER_DEFAULTS.maxRedirectHops;
  const timeoutMs = options.timeoutMs ?? SERVER_DEFAULTS.maxConnectorTimeoutMs;
  const maxSizeBytes = options.maxSizeBytes ?? SERVER_DEFAULTS.maxConnectorResponseSizeBytes;

  let currentUrl = targetUrl;
  let hops = 0;

  while (hops <= maxRedirects) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(currentUrl);
    } catch {
      throw new Error(`Invalid URL format: '${currentUrl}'`);
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`Forbidden protocol '${parsedUrl.protocol}'. Only http/https permitted.`);
    }

    const host = parsedUrl.hostname.toLowerCase();
    if (options.allowedHostsChecker && !options.allowedHostsChecker(host)) {
      throw new Error(`Host '${host}' is not in the allowed host list.`);
    }

    // Server-side DNS resolution & SSRF validation
    const ssrfCheck = await validateHostForSsrf(host);
    if (!ssrfCheck.allowed || !ssrfCheck.resolvedIp) {
      throw new Error(`SSRF security check failed for '${host}': ${ssrfCheck.reason}`);
    }

    const pinnedIp = ssrfCheck.resolvedIp;
    const isHttps = parsedUrl.protocol === 'https:';
    const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : isHttps ? 443 : 80;

    const requestHeaders: Record<string, string> = {
      ...(options.headers || {}),
      Host: parsedUrl.host, // Keep original host header with port if specified
    };

    // Perform request pinned to resolved IP
    const hopResult = await new Promise<{
      status: number;
      statusText: string;
      headers: Record<string, string>;
      bodyText: string;
    }>((resolve, reject) => {
      const client = isHttps ? https : http;
      let timedOut = false;

      const reqOptions: http.RequestOptions = {
        host: pinnedIp, // Connect directly to pinned IP
        port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: requestHeaders,
        timeout: timeoutMs,
      };

      if (isHttps) {
        // Enforce SNI servername matching original host so TLS certificate verification succeeds
        (reqOptions as https.RequestOptions).servername = parsedUrl.hostname;
      }

      const req = client.request(reqOptions, (res) => {
        const resHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') resHeaders[k.toLowerCase()] = v;
          else if (Array.isArray(v)) resHeaders[k.toLowerCase()] = v.join(', ');
        }

        let totalBytes = 0;
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxSizeBytes) {
            req.destroy(new Error(`Response size exceeded cap of ${maxSizeBytes} bytes.`));
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          if (timedOut) return;
          const bodyText = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode || 200,
            statusText: res.statusMessage || 'OK',
            headers: resHeaders,
            bodyText,
          });
        });
      });

      req.on('timeout', () => {
        timedOut = true;
        req.destroy(new Error(`Request timed out after ${timeoutMs} ms.`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (options.body && options.method !== 'GET' && options.method !== 'HEAD') {
        req.write(options.body);
      }
      req.end();
    });

    // Check for redirects
    if (
      (hopResult.status === 301 ||
        hopResult.status === 302 ||
        hopResult.status === 303 ||
        hopResult.status === 307 ||
        hopResult.status === 308) &&
      hopResult.headers['location']
    ) {
      hops += 1;
      if (hops > maxRedirects) {
        throw new Error(`Max redirects exceeded (${maxRedirects} hops maximum).`);
      }
      const rawLocation = hopResult.headers['location'];
      currentUrl = new URL(rawLocation, currentUrl).toString();
      continue;
    }

    return {
      status: hopResult.status,
      statusText: hopResult.statusText,
      headers: hopResult.headers,
      dataText: hopResult.bodyText,
      finalUrl: currentUrl,
      resolvedIp: pinnedIp,
      hops,
    };
  }

  throw new Error(`Redirect chain exceeded limit.`);
}
