/**
 * Local deterministic desktop privacy patterns. These values never leave the main process.
 * Matching is intentionally conservative: false positives cause extra blur, not data upload.
 */
export const SENSITIVE_WINDOW_PATTERN = /password.?manager|1password|bitwarden|keepass|lastpass|dashlane|credential|keychain|proton.?pass|\bbank(?:ing)?\b|wallet|brokerage|trading|investment|portfolio|finance|financial|account|statement|transaction|mobile.?banking|mobile.?money|\bmomo\b|tax|payroll|medical|health.?portal|patient|mychart|authenticator|security.?settings|sign.?in|login|checkout|payment|billing|invoice|insurance|pension|mortgage|loan|private.?vault|\bgmail\b|\boutlook\b|thunderbird|proton.?mail|apple.?mail|\bmail\b|paypal|revolut|wise|cash.?app|venmo/i;

export const SENSITIVE_CONTROL_PATTERN = /password|passcode|one.?time|verification.?code|otp|2fa|mfa|pin|security.?code|cvv|credit.?card|debit.?card|card.?number|account.?number|account|routing|iban|social.?security|\bssn\b|tax.?id|bank|wallet|beneficiary|transaction|balance|statement|payment|transfer|invoice|billing|amount|secret|api.?key|access.?key|recovery|seed.?phrase|private.?key|email|phone|telephone|address|username|user.?name|date.?of.?birth|birth.?date/i;

// Detect common personal identifiers and credential formats in native accessible values.
// This is heuristic value matching, not OCR or full semantic understanding of screen pixels.
export const SENSITIVE_VALUE_PATTERN = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]?){13,19}\b|\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b|\b(?:\+?\d[\s().-]*){9,15}\b|\b(?:sk_live_|sk_test_|sk-ant-|gh[pousr]_|AKIA|AIza|xox[baprs]-)[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._-]{12,}\b|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b)/i;

export function isSensitiveAccessibleValue(value: unknown): boolean {
  return SENSITIVE_VALUE_PATTERN.test(String(value ?? ''));
}
