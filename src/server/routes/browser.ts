/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hardened Browser Engine Routes (`src/server/routes/browser.ts`)
 * - Hardened ReaderEngine (/api/browser/read): server-side DNS resolution, SSRF blocking, IP pinning,
 *   manual redirect loop re-validation (max 3 hops), size cap (512 KB), and timeout cap.
 * - Browser self-test (/api/browser/self-test)
 * - Open VSX extension registry search (/api/openvsx/search)
 */

import { Router } from 'express';
import { executeSsrfProtectedFetch } from '../middleware/ssrf';
import {
  scanContentForPromptInjection,
  runBrowserSelfTest,
  searchOpenVsxRegistry,
} from '../../packages/browser_ide/index';

export function createBrowserRouter(): Router {
  const router = Router();

  // Browser Engine Self-Test
  router.get('/browser/self-test', async (_req, res) => {
    try {
      const result = await runBrowserSelfTest();
      res.status(200).json({ ok: true, result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Self-test failed' });
    }
  });

  // Hardened ReaderEngine Fetch with SSRF Defense & IP Pinning
  router.post('/browser/read', async (req, res) => {
    try {
      const { url } = req.body || {};
      if (!url || typeof url !== 'string') {
        res.status(400).json({ ok: false, error: 'Target URL is required.' });
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(url.trim());
      } catch {
        res.status(400).json({ ok: false, error: 'Invalid URL format.' });
        return;
      }

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        res.status(403).json({
          ok: false,
          error: `Forbidden protocol '${parsed.protocol}'. Only http/https supported.`,
        });
        return;
      }

      // Execute hardened SSRF-protected fetch with DNS resolution, IP pinning, and manual redirect loop checks
      const fetchResult = await executeSsrfProtectedFetch(parsed.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Blaize-Accountable-Desktop/3.0 (ReaderEngine; accountable-ai)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        },
        timeoutMs: 10000,
        maxSizeBytes: 524288, // 512 KB
        maxRedirects: 3,
      });

      if (fetchResult.status >= 400) {
        res.status(fetchResult.status).json({
          ok: false,
          error: `HTTP ${fetchResult.status} fetching URL: ${fetchResult.statusText}`,
          url: fetchResult.finalUrl,
        });
        return;
      }

      const html = fetchResult.dataText;
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : parsed.hostname;

      // Extract links (up to 50)
      const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi;
      const links: Array<{ href: string; text: string }> = [];
      let linkMatch: RegExpExecArray | null;
      while ((linkMatch = linkRegex.exec(html)) !== null && links.length < 50) {
        const href = linkMatch[1].trim();
        const text = linkMatch[2].replace(/<[^>]+>/g, '').trim();
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          try {
            const absoluteHref = new URL(href, fetchResult.finalUrl).toString();
            links.push({ href: absoluteHref, text: text || absoluteHref });
          } catch {
            // ignore malformed URLs
          }
        }
      }

      // Extract tables (up to 5)
      const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
      const tables: Array<{ headers: string[]; rows: string[][] }> = [];
      let tableMatch: RegExpExecArray | null;
      while ((tableMatch = tableRegex.exec(html)) !== null && tables.length < 5) {
        const tableHtml = tableMatch[1];
        const headers: string[] = [];
        const rows: string[][] = [];

        const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
        let thMatch: RegExpExecArray | null;
        while ((thMatch = thRegex.exec(tableHtml)) !== null) {
          headers.push(thMatch[1].replace(/<[^>]+>/g, '').trim());
        }

        const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        let trMatch: RegExpExecArray | null;
        while ((trMatch = trRegex.exec(tableHtml)) !== null) {
          const rowCells: string[] = [];
          const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          let tdMatch: RegExpExecArray | null;
          while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
            rowCells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
          }
          if (rowCells.length > 0) {
            rows.push(rowCells);
          }
        }

        if (headers.length > 0 || rows.length > 0) {
          tables.push({ headers, rows: rows.slice(0, 20) });
        }
      }

      // Clean readable text
      const strippedHtml = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n\n')
        .trim();

      const readableText = strippedHtml.slice(0, 15000);
      const injectionFlags = scanContentForPromptInjection(readableText);

      res.status(200).json({
        ok: true,
        engine: 'ReaderEngine',
        engineLabel: 'ReaderEngine (Hardened Server-Side)',
        url: fetchResult.finalUrl,
        resolvedIp: fetchResult.resolvedIp,
        hops: fetchResult.hops,
        title,
        readableText,
        links,
        tables,
        metadata: {
          status: fetchResult.status,
          contentType: fetchResult.headers['content-type'] || 'text/html',
          byteSize: html.length,
          fetchedAt: new Date().toISOString(),
        },
        injectionFlags,
        untrustedTag: '[Untrusted External Web Content]',
      });
    } catch (err: any) {
      res.status(500).json({
        ok: false,
        error:
          err?.name === 'AbortError'
            ? 'Page fetch timed out.'
            : err?.message || 'Page fetch failed.',
      });
    }
  });

  // Open VSX Search Endpoint
  router.get('/openvsx/search', async (req, res) => {
    try {
      const query =
        typeof req.query.q === 'string'
          ? req.query.q
          : typeof req.query.query === 'string'
            ? req.query.query
            : '';
      const result = await searchOpenVsxRegistry(query);
      res.status(200).json({
        ok: true,
        source: result.isRealRegistryResult ? 'open-vsx.org' : 'recorded-fixtures',
        total: result.extensions.length,
        extensions: result.extensions,
        notice: 'Using Open VSX, the open registry for VS Code-compatible editors.',
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Open VSX query failed.' });
    }
  });

  return router;
}
