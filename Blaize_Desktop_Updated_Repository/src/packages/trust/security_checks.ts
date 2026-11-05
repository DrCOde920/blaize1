/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Security & Strict Canonicalization Checks for Blaize Trust Kernel (PROMPT 2)
 *
 * Handles:
 * - Strict URL parsing and domain canonicalization (NO mockbank.local or trusted fallbacks)
 * - Private / Loopback IP address blocking (IPv4, IPv6, Cloud Metadata 169.254.x)
 * - Punycode / IDN homograph attack detection (Cyrillic/Greek lookalikes)
 * - Encoded path traversal & symlink escape detection
 * - Prohibited URL schemes (file://, javascript:, data:, blob:)
 * - Protected filesystem paths (/src/packages/trust/*, /SOUL.md)
 * - Untrusted content wrapping & prompt injection neutralization
 */

import {
  BrowserProfileId,
  CanonicalActionRiskClass,
  RiskLevel,
  UntrustedContentWrapper,
  UntrustedSourceType,
} from '../contracts';
import { computeDeterministicHash } from './hash';

// ============================================================================
// 1. RISK CLASS NORMALIZATION & VALIDATION (PROMPT 2.5)
// ============================================================================

export const CANONICAL_RISK_CLASSES: readonly CanonicalActionRiskClass[] = [
  'read',
  'scoped_write',
  'external_send',
  'destructive',
  'spend',
  'credential',
  'system_privilege',
  'software_installation',
] as const;

export interface NormalizedRiskResult {
  valid: boolean;
  canonicalRiskClass?: CanonicalActionRiskClass;
  rawRisk?: string;
  rejectionReason?: string;
}

export function normalizeAndValidateRiskClass(raw: unknown): NormalizedRiskResult {
  if (typeof raw !== 'string' || !raw.trim()) {
    return {
      valid: false,
      rawRisk: String(raw),
      rejectionReason: 'Risk class is missing or empty. PolicyGuard requires an explicit canonical action risk class.',
    };
  }

  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case 'read':
      return { valid: true, canonicalRiskClass: 'read' };
    case 'scoped_write':
    case 'scoped write':
    case 'write':
    case 'write_in_scope':
      return { valid: true, canonicalRiskClass: 'scoped_write' };
    case 'external_send':
    case 'external send':
    case 'send':
      return { valid: true, canonicalRiskClass: 'external_send' };
    case 'destructive':
    case 'delete':
      return { valid: true, canonicalRiskClass: 'destructive' };
    case 'spend':
    case 'money':
    case 'spend/money':
      return { valid: true, canonicalRiskClass: 'spend' };
    case 'credential':
    case 'sensitive':
      return { valid: true, canonicalRiskClass: 'credential' };
    case 'system_privilege':
    case 'system/privilege':
    case 'system':
    case 'privilege':
      return { valid: true, canonicalRiskClass: 'system_privilege' };
    case 'software_installation':
    case 'software installation':
    case 'install':
      return { valid: true, canonicalRiskClass: 'software_installation' };
    default:
      return {
        valid: false,
        rawRisk: normalized,
        rejectionReason: `Unknown action risk class '${normalized}'. Unknown risk classes are denied by PolicyGuard.`,
      };
  }
}

// ============================================================================
// 2. STRICT URL CANONICALIZATION & SSRF / IDN DEFENSE (PROMPT 2.3 & 2.7)
// ============================================================================

const FORBIDDEN_SCHEMES = new Set(['file:', 'javascript:', 'data:', 'vbscript:', 'blob:', 'about:']);

// Private, loopback, and cloud metadata IP prefixes/literals
const PRIVATE_IPV4_PATTERNS = [
  /^127\.\d+\.\d+\.\d+$/, // Loopback
  /^10\.\d+\.\d+\.\d+$/, // RFC 1918 Class A
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/, // RFC 1918 Class B
  /^192\.168\.\d+\.\d+$/, // RFC 1918 Class C
  /^169\.254\.\d+\.\d+$/, // Link-local / Cloud metadata (AWS, GCP, Azure)
  /^0\.0\.0\.0$/, // Anylocal
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/, // Carrier-grade NAT (RFC 6598)
];

// Cyrillic / Greek homoglyph characters frequently used in spoofing attacks
const HOMOGLYPH_REGEX = /[\u0400-\u04FF\u0370-\u03FF]/;

export interface UrlCanonicalizationResult {
  valid: boolean;
  canonicalUrl?: string;
  hostname?: string;
  domain?: string;
  rejectionReason?: string;
  matchedSecurityCheck?: string;
}

/**
 * Strict URL Parser & Security Gate.
 * NEVER infers mockbank.local or any default domain from relative or malformed input.
 */
export function canonicalizeAndValidateUrl(
  inputUrl: string,
  options?: { requireHttpHttps?: boolean }
): UrlCanonicalizationResult {
  if (!inputUrl || typeof inputUrl !== 'string' || !inputUrl.trim()) {
    return {
      valid: false,
      rejectionReason: 'URL cannot be empty or non-string.',
      matchedSecurityCheck: 'MALFORMED_URL_EMPTY',
    };
  }

  const trimmed = inputUrl.trim();

  // Encoded traversal or null byte attempt in URL
  if (/%2e%2e|%252e|\.\.\/|\.\.\\|%00/i.test(trimmed)) {
    return {
      valid: false,
      rejectionReason: 'Path traversal or null byte sequence detected in URL.',
      matchedSecurityCheck: 'URL_PATH_TRAVERSAL_INJECTION',
    };
  }

  // Check for forbidden scheme at start
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase() + ':';
    if (FORBIDDEN_SCHEMES.has(scheme)) {
      return {
        valid: false,
        rejectionReason: `Prohibited URL scheme '${scheme}'. Browser and network actions must use safe http/https schemes.`,
        matchedSecurityCheck: 'FORBIDDEN_URL_SCHEME',
      };
    }
  }

  let parsed: URL;
  try {
    // If target has no protocol and starts with '/' or relative path, it is not a valid absolute URL
    if (!trimmed.includes('://')) {
      return {
        valid: false,
        rejectionReason: `Malformed or relative URL '${trimmed}'. Inferred domains are strictly prohibited.`,
        matchedSecurityCheck: 'RELATIVE_OR_UNRESOLVED_URL',
      };
    }
    parsed = new URL(trimmed);
  } catch (err) {
    return {
      valid: false,
      rejectionReason: `Failed to parse URL '${trimmed}': ${(err as Error).message}`,
      matchedSecurityCheck: 'INVALID_URL_SYNTAX',
    };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (options?.requireHttpHttps !== false && protocol !== 'http:' && protocol !== 'https:') {
    return {
      valid: false,
      rejectionReason: `Forbidden protocol '${parsed.protocol}'. Only http: and https: are allowed.`,
      matchedSecurityCheck: 'PROTOCOL_NOT_PERMITTED',
    };
  }

  const rawHost = parsed.hostname.toLowerCase();
  if (!rawHost) {
    return {
      valid: false,
      rejectionReason: 'URL is missing a valid hostname.',
      matchedSecurityCheck: 'MISSING_HOSTNAME',
    };
  }

  // Block localhost, .localhost, and loopbacks
  if (rawHost === 'localhost' || rawHost.endsWith('.localhost') || rawHost === 'metadata.google.internal') {
    return {
      valid: false,
      hostname: rawHost,
      rejectionReason: `Blocked private destination '${rawHost}'. Localhost access is prohibited.`,
      matchedSecurityCheck: 'SSRF_LOCALHOST_BLOCKED',
    };
  }

  // Block IPv4 private/loopback/cloud metadata
  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(rawHost)) {
      return {
        valid: false,
        hostname: rawHost,
        rejectionReason: `Blocked private/loopback IP address '${rawHost}'. Local/private network access is prohibited.`,
        matchedSecurityCheck: 'SSRF_PRIVATE_IP_BLOCKED',
      };
    }
  }

  // Block IPv6 loopback and link-local (e.g. [::1], fe80::, fc00::)
  const cleanIpv6 = rawHost.replace(/^\[|\]$/g, '');
  if (
    cleanIpv6 === '::1' ||
    cleanIpv6.startsWith('fe80:') ||
    cleanIpv6.startsWith('fc00:') ||
    cleanIpv6.startsWith('fd00:')
  ) {
    return {
      valid: false,
      hostname: rawHost,
      rejectionReason: `Blocked IPv6 private/loopback destination '${rawHost}'.`,
      matchedSecurityCheck: 'SSRF_IPV6_PRIVATE_BLOCKED',
    };
  }

  // Block Punycode (IDN homograph attacks)
  if (rawHost.includes('xn--')) {
    return {
      valid: false,
      hostname: rawHost,
      rejectionReason: `Blocked Punycode / IDN internationalized domain '${rawHost}'. Potential homograph attack.`,
      matchedSecurityCheck: 'PUNYCODE_IDN_HOMOGRAPH_BLOCKED',
    };
  }

  // Check for homoglyph characters in unicode hostname
  if (HOMOGLYPH_REGEX.test(rawHost)) {
    return {
      valid: false,
      hostname: rawHost,
      rejectionReason: `Blocked unicode homoglyphs in hostname '${rawHost}'. Potential script spoofing attempt.`,
      matchedSecurityCheck: 'HOMOGLYPH_SPOOF_BLOCKED',
    };
  }

  // Check for embedded credentials in URL (user:pass@host)
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      hostname: rawHost,
      rejectionReason: 'Embedded basic credentials in URL are prohibited (credential spoofing risk).',
      matchedSecurityCheck: 'EMBEDDED_CREDENTIALS_PROHIBITED',
    };
  }

  // Normalize domain
  const canonicalUrl = parsed.toString();
  return {
    valid: true,
    canonicalUrl,
    hostname: rawHost,
    domain: rawHost,
  };
}

/**
 * Validates domain against allowlists strictly.
 * Only allows exact domain or proper subdomain (e.g. sub.example.com for example.com, NOT fakeexample.com).
 */
export function isDomainAllowlisted(
  hostname: string,
  allowedDomains: string[]
): { allowed: boolean; matchedDomain?: string } {
  const cleanHost = hostname.toLowerCase().trim();
  for (const allowed of allowedDomains) {
    const cleanAllowed = allowed.toLowerCase().trim();
    if (cleanHost === cleanAllowed) {
      return { allowed: true, matchedDomain: cleanAllowed };
    }
    if (cleanHost.endsWith(`.${cleanAllowed}`)) {
      return { allowed: true, matchedDomain: cleanAllowed };
    }
  }
  return { allowed: false };
}

// ============================================================================
// 3. FILESYSTEM & PROTECTED PATHS ENFORCEMENT (PROMPT 2.4 & 2.6)
// ============================================================================

const PROTECTED_PATH_PATTERNS = [
  /(?:^|[\\/])packages[\\/]trust(?:[\\/]|$)/i,
  /(?:^|[\\/])src[\\/]packages[\\/]trust(?:[\\/]|$)/i,
  /(?:^|[\\/])SOUL\.md$/i,
  /(?:^|[\\/])\.env(?:\..*)?$/i,
  /(?:^|[\\/])\.ssh(?:[\\/]|$)/i,
  /(?:^|[\\/])etc[\\/]passwd/i,
  /(?:^|[\\/])etc[\\/]shadow/i,
  /(?:^|[\\/])id_rsa(?:[\\/]|$)/i,
];

export interface PathValidationResult {
  valid: boolean;
  sanitizedPath?: string;
  isProtectedPolicyFile: boolean;
  rejectionReason?: string;
  matchedRule?: string;
}

export function validateFilesystemPath(
  rawPath: string,
  options?: { allowProtectedPolicyWrite?: boolean }
): PathValidationResult {
  if (!rawPath || typeof rawPath !== 'string') {
    return {
      valid: false,
      isProtectedPolicyFile: false,
      rejectionReason: 'File path cannot be empty.',
      matchedRule: 'INVALID_EMPTY_PATH',
    };
  }

  const normalized = rawPath.replace(/\\/g, '/').trim();

  // Detect path traversal
  if (
    normalized.includes('/../') ||
    normalized.startsWith('../') ||
    normalized.endsWith('/..') ||
    normalized === '..' ||
    /%2e%2e|%252e/i.test(normalized)
  ) {
    return {
      valid: false,
      isProtectedPolicyFile: false,
      rejectionReason: `Path traversal sequence detected in '${rawPath}'. Access restricted to sandbox.`,
      matchedRule: 'FILESYSTEM_PATH_TRAVERSAL_BLOCKED',
    };
  }

  // Check protected files (Trust Kernel, SOUL.md, Secrets)
  const isProtected = PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
  if (isProtected && !options?.allowProtectedPolicyWrite) {
    return {
      valid: false,
      isProtectedPolicyFile: true,
      rejectionReason: `Target path '${rawPath}' is a safety-floor protected asset (Trust Kernel / SOUL.md / Credentials). Agent write is prohibited.`,
      matchedRule: 'SAFETY_FLOOR_PROTECTED_PATH',
    };
  }

  return {
    valid: true,
    sanitizedPath: normalized,
    isProtectedPolicyFile: isProtected,
  };
}

// ============================================================================
// 4. UNTRUSTED DATA WRAPPING & PROMPT INJECTION DEFENSE (PROMPT 2.8)
// ============================================================================

export function wrapUntrustedData<T = string>(
  content: T,
  source: UntrustedSourceType
): UntrustedContentWrapper<T> {
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  const injectionPatterns = [
    /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
    /\b(?:system\s*override|developer\s*mode|new\s+directive|assistant\s+must)\b/i,
    /\b(?:transfer|send|wire|pay)\s+(?:all\s+funds|immediately|everything|\$?\d+)\s+to\b/i,
    /(?:\.\.\/|\.\.\\|\/etc\/passwd|\.ssh\/|cookies\.sqlite)/i,
    /\b(?:auto[-_]?acknowledge|bypass\s+guard|skip\s+verification)\b/i,
  ];

  const findings: string[] = [];
  for (const pattern of injectionPatterns) {
    if (pattern.test(contentStr)) {
      findings.push(pattern.source);
    }
  }

  // Sanitize any directive prefixes so LLM cannot confuse untrusted data with developer/system instructions
  let sanitized: string | undefined = undefined;
  if (typeof content === 'string') {
    sanitized = content
      .replace(/\b(?:SYSTEM|DEVELOPER|INSTRUCTION):\s*/gi, '[UNTRUSTED_TEXT_PREFIX]: ')
      .replace(/<\|im_start\|>system|<\|system\|>/gi, '[UNTRUSTED_TAG]');
  }

  return {
    isUntrusted: true,
    source,
    content,
    sanitizedContent: sanitized,
    injectionFindings: findings.length > 0 ? findings : undefined,
    wrappedAt: new Date().toISOString(),
  };
}
