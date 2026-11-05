/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PROMPT: FILE MAP ('My Places') — Library > Places
 * Blaize learns where things are, where things belong, and where it must never go.
 *
 * Pure, deterministic, unit-tested module implementing:
 * 1. PlaceRule Schema (Zod) & Local Map Model (path, friendly label, purpose, what belongs there,
 *    allowed actions, status: Allowed | Ask first | Never)
 * 2. Read-Only Metadata Indexer & FileSystemBridge (names, types, sizes, dates only; never reads
 *    contents unless explicitly enabled for an Allowed place; encrypted-at-rest local store)
 * 3. Map Freshness & Map Health (detects moved/renamed folders via stable folderFileId/hash,
 *    stale rules, missing folders, and 1-click Rescan)
 * 4. Teach It Three Ways (Describe -> Zod PlaceRule proposal, Record -> keyframe blur + transcript,
 *    Snap -> screenshot/sketch folder extraction, and Corrections -> rule update proposals)
 * 5. PlacesGuard (Enforced in code across files plugin, workspace tools, skills, scheduled chores,
 *    shell commands, subagents, and connectors; canonicalizes '..', symlinks/junctions, case,
 *    UNC paths, Windows 8.3 short names, and drive roots; Deny beats Allow; Default Never list;
 *    'That folder is off limits' + re-auth to change Never -> Allowed)
 * 6. GET & PUT: places.find(intent) and places.suggest_destination(file) + Reversible Undo Journal
 */

import { z } from 'zod';
import { computeDeterministicHash } from '../trust';

// ============================================================================
// 1. ZOD SCHEMAS & TYPES FOR 'MY PLACES'
// ============================================================================

export const PlaceStatusSchema = z.enum(['allowed', 'ask_first', 'never']);
export type PlaceStatus = z.infer<typeof PlaceStatusSchema>;

export const PlaceAllowedActionSchema = z.enum([
  'read',
  'add',
  'move',
  'rename',
  'delete',
]);
export type PlaceAllowedAction = z.infer<typeof PlaceAllowedActionSchema>;

export const PlaceBelongsSpecSchema = z.object({
  fileTypes: z.array(z.string()),
  namePatterns: z.array(z.string()),
  keywords: z.array(z.string()),
});
export type PlaceBelongsSpec = z.infer<typeof PlaceBelongsSpecSchema>;

export const PlaceRuleSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  canonicalPath: z.string().min(1),
  label: z.string().min(1),
  purpose: z.string().min(1),
  belongsHere: PlaceBelongsSpecSchema,
  allowedActions: z.array(PlaceAllowedActionSchema),
  status: PlaceStatusSchema,
  /** Never read file contents unless explicitly allowed for this specific place */
  allowContentIndexing: z.boolean().default(false),
  isDefaultNever: z.boolean().default(false),
  defaultNeverCategory: z
    .enum([
      'system_folder',
      'ssh_and_keys',
      'browser_profile',
      'password_vault',
      'app_private_data',
      'user_custom',
    ])
    .optional(),
  /** Stable folder identifier / hash used to detect moved or renamed folders */
  folderFileId: z.string().min(1),
  lastScannedAtIso: z.string(),
  itemCount: z.number().int().nonnegative(),
  correctionCount: z.number().int().nonnegative().default(0),
});

export type PlaceRule = z.infer<typeof PlaceRuleSchema>;

export interface IndexedFileMetadata {
  fileId: string;
  name: string;
  extension: string;
  mimeCategory: 'document' | 'spreadsheet' | 'image' | 'archive' | 'code' | 'other';
  sizeBytes: number;
  modifiedAtIso: string;
  parentPlaceId: string;
  parentPath: string;
  isRecent?: boolean;
  /**
   * Optional small snippet ONLY populated when the parent place has
   * `status !== 'never'` AND `allowContentIndexing === true`.
   */
  allowedContentSnippet?: string;
}

export interface EncryptedLocalPlacesStoreSnapshot {
  schemaVersion: 1;
  cipherAlgorithm: 'AES-GCM-256-LOCAL';
  encryptedAtIso: string;
  ciphertextChecksum: string;
  chosenRoots: string[];
  places: PlaceRule[];
  indexedFiles: IndexedFileMetadata[];
}

// ============================================================================
// 2. PATH CANONICALIZATION & PLACESGUARD (ENFORCED IN CODE, NOT PROMPTS)
// ============================================================================

const WINDOWS_SHORT_NAME_MAP: Record<string, string> = {
  'progra~1': 'program files',
  'progra~2': 'program files (x86)',
  'docume~1': 'documents and settings',
  'admini~1': 'administrator',
  'locala~1': 'localappdata',
  'applic~1': 'application data',
};

export interface CanonicalizeOptions {
  homeDir?: string;
  cwd?: string;
  /** Map of canonical symlink/junction source -> target path */
  symlinksAndJunctions?: Record<string, string>;
}

/**
 * Canonicalizes any file or folder path before checking PlacesGuard:
 * - Expands `~` to `homeDir` (default `/Users/alex`)
 * - Converts backslashes `\` to `/`
 * - Handles Windows extended-length prefixes (`\\?\`, `\\.\`) and UNC paths (`\\server\share`)
 * - Expands Windows 8.3 short names (`PROGRA~1` -> `program files`, etc.)
 * - Resolves `.` and `..` segments so path traversal (`Downloads/../../.ssh`) cannot escape
 * - Resolves symlinks and Windows junctions iteratively (up to 8 hops, cycle-safe)
 * - Normalizes case to lowercase for security comparison so `/Users/Alex/.SSH` or `C:\Windows\System32` cannot bypass
 */
export function canonicalizePlacePath(
  rawPath: string,
  options: CanonicalizeOptions = {}
): string {
  const homeDir = (options.homeDir || '/Users/alex').replace(/\\/g, '/').replace(/\/+$/, '');
  const cwd = (options.cwd || homeDir).replace(/\\/g, '/').replace(/\/+$/, '');

  let p = (rawPath || '').trim();
  if (!p) return '/';

  // Convert all backslashes to forward slashes
  p = p.replace(/\\/g, '/');

  // Strip Windows extended-length device prefixes: //?/UNC/server/share or //?/C:/...
  if (p.toLowerCase().startsWith('//?/unc/')) {
    p = '//' + p.slice(8);
  } else if (p.startsWith('//?/') || p.startsWith('//./')) {
    p = p.slice(4);
  }

  // Detect UNC network path: //server/share/...
  const isUnc = p.startsWith('//') && !p.startsWith('///');

  // Expand leading ~
  if (p === '~') {
    p = homeDir;
  } else if (p.startsWith('~/')) {
    p = `${homeDir}/${p.slice(2)}`;
  }

  // Handle relative paths (not starting with /, //, or drive letter C:)
  const hasDriveLetter = /^[a-zA-Z]:(\/|$)/.test(p);
  if (!p.startsWith('/') && !hasDriveLetter) {
    p = `${cwd}/${p}`;
  }

  // Split prefix (UNC //server/share, Drive c:, or root /)
  let prefix = '/';
  let remainder = p;

  if (isUnc) {
    const uncParts = p.slice(2).split('/').filter(Boolean);
    if (uncParts.length >= 2) {
      prefix = `//${uncParts[0].toLowerCase()}/${uncParts[1].toLowerCase()}`;
      remainder = uncParts.slice(2).join('/');
    } else if (uncParts.length === 1) {
      prefix = `//${uncParts[0].toLowerCase()}`;
      remainder = '';
    }
  } else if (hasDriveLetter) {
    prefix = p.slice(0, 2).toLowerCase();
    remainder = p.slice(2).replace(/^\/+/, '');
  } else {
    prefix = '';
    remainder = p.replace(/^\/+/, '');
  }

  // Resolve segments (., .., and Windows 8.3 short names)
  const rawSegments = remainder.split('/').filter((seg) => seg.length > 0);
  const stack: string[] = [];

  for (const seg of rawSegments) {
    if (seg === '.') continue;
    if (seg === '..') {
      if (stack.length > 0) stack.pop();
      continue;
    }
    const lowerSeg = seg.toLowerCase();
    const expandedSeg = WINDOWS_SHORT_NAME_MAP[lowerSeg] || lowerSeg;
    stack.push(expandedSeg);
  }

  let normalized =
    prefix === ''
      ? '/' + stack.join('/')
      : stack.length > 0
        ? `${prefix}/${stack.join('/')}`
        : prefix.startsWith('//')
          ? prefix
          : `${prefix}/`;

  // Resolve symlinks and junctions iteratively (up to 8 hops)
  if (options.symlinksAndJunctions) {
    const normalizedLinks: Array<{ from: string; to: string }> = Object.entries(
      options.symlinksAndJunctions
    ).map(([k, v]) => ({
      from: canonicalizePlacePath(k, { homeDir, cwd }),
      to: canonicalizePlacePath(v, { homeDir, cwd }),
    }));

    for (let hop = 0; hop < 8; hop++) {
      let replaced = false;
      for (const link of normalizedLinks) {
        if (normalized === link.from) {
          normalized = link.to;
          replaced = true;
          break;
        }
        if (normalized.startsWith(link.from + '/')) {
          const suffix = normalized.slice(link.from.length);
          normalized = canonicalizePlacePath(link.to + suffix, { homeDir, cwd });
          replaced = true;
          break;
        }
      }
      if (!replaced) break;
    }
  }

  // Strip trailing slash unless drive root or '/'
  if (normalized.length > 1 && normalized.endsWith('/') && !/^[a-z]:\/$/.test(normalized)) {
    normalized = normalized.replace(/\/+$/, '');
  }

  return normalized;
}

/**
 * Checks whether `targetCanonical` is equal to or inside `folderCanonical`.
 */
export function isPathInsideOrEqual(targetCanonical: string, folderCanonical: string): boolean {
  const t = targetCanonical.toLowerCase().replace(/\/+$/, '');
  const f = folderCanonical.toLowerCase().replace(/\/+$/, '');
  if (!f || f === '') return t === '';
  if (f === '/') return t.startsWith('/');
  if (/^[a-z]:$/.test(f)) {
    return t === f || t.startsWith(f + '/');
  }
  return t === f || t.startsWith(f + '/');
}

// ============================================================================
// 3. DEFAULT PLACES & DEFAULT NEVER-GO ZONES
// ============================================================================

export const DEFAULT_CHOSEN_ROOTS: string[] = [
  '/Users/alex/Documents',
  '/Users/alex/Downloads',
  '/Users/alex/Pictures',
  '/Users/alex/Projects',
];

export const DEFAULT_NEVER_PLACES: PlaceRule[] = [
  {
    id: 'place-never-ssh',
    path: '~/.ssh',
    canonicalPath: canonicalizePlacePath('~/.ssh'),
    label: 'SSH Keys & Certificates',
    purpose: 'Private SSH keys, known hosts, and identity certificates',
    belongsHere: {
      fileTypes: ['pem', 'pub', 'key'],
      namePatterns: ['id_rsa*', 'id_ed25519*', 'authorized_keys', 'config'],
      keywords: ['ssh', 'private key', 'certificate'],
    },
    allowedActions: [],
    status: 'never',
    allowContentIndexing: false,
    isDefaultNever: true,
    defaultNeverCategory: 'ssh_and_keys',
    folderFileId: 'fid-never-ssh',
    lastScannedAtIso: 'Never scanned (Off limits)',
    itemCount: 0,
    correctionCount: 0,
  },
  {
    id: 'place-never-system-etc',
    path: '/etc',
    canonicalPath: canonicalizePlacePath('/etc'),
    label: 'System Configuration (/etc & /System)',
    purpose: 'Operating system configuration, sudoers, and passwd files',
    belongsHere: {
      fileTypes: ['conf', 'cfg'],
      namePatterns: ['passwd', 'shadow', 'hosts', 'sudoers'],
      keywords: ['system', 'etc', 'daemon'],
    },
    allowedActions: [],
    status: 'never',
    allowContentIndexing: false,
    isDefaultNever: true,
    defaultNeverCategory: 'system_folder',
    folderFileId: 'fid-never-etc',
    lastScannedAtIso: 'Never scanned (Off limits)',
    itemCount: 0,
    correctionCount: 0,
  },
  {
    id: 'place-never-windows-sys',
    path: 'C:\\Windows\\System32',
    canonicalPath: canonicalizePlacePath('C:\\Windows\\System32'),
    label: 'Windows System32 & Program Files',
    purpose: 'Windows OS binaries, drivers, and system registry hives',
    belongsHere: {
      fileTypes: ['dll', 'sys', 'exe'],
      namePatterns: ['*'],
      keywords: ['windows', 'system32', 'drivers'],
    },
    allowedActions: [],
    status: 'never',
    allowContentIndexing: false,
    isDefaultNever: true,
    defaultNeverCategory: 'system_folder',
    folderFileId: 'fid-never-winsys',
    lastScannedAtIso: 'Never scanned (Off limits)',
    itemCount: 0,
    correctionCount: 0,
  },
  {
    id: 'place-never-windows-progfiles',
    path: 'C:\\Program Files',
    canonicalPath: canonicalizePlacePath('C:\\Program Files'),
    label: 'Windows Program Files',
    purpose: 'Installed Windows applications and binaries',
    belongsHere: {
      fileTypes: ['exe', 'dll'],
      namePatterns: ['*'],
      keywords: ['program files', 'applications'],
    },
    allowedActions: [],
    status: 'never',
    allowContentIndexing: false,
    isDefaultNever: true,
    defaultNeverCategory: 'system_folder',
    folderFileId: 'fid-never-progfiles',
    lastScannedAtIso: 'Never scanned (Off limits)',
    itemCount: 0,
    correctionCount: 0,
  },
  {
    id: 'place-never-browser-profile',
    path: '~/.config/google-chrome',
    canonicalPath: canonicalizePlacePath('~/.config/google-chrome'),
    label: 'Browser Profiles & Cookie Stores',
    purpose: 'Browser session cookies, saved logins, and web history databases',
    belongsHere: {
      fileTypes: ['sqlite', 'ldb', 'json'],
      namePatterns: ['Cookies*', 'Login Data*'],
      keywords: ['browser', 'cookies', 'chrome', 'profile'],
    },
    allowedActions: [],
    status: 'never',
    allowContentIndexing: false,
    isDefaultNever: true,
    defaultNeverCategory: 'browser_profile',
    folderFileId: 'fid-never-chrome',
    lastScannedAtIso: 'Never scanned (Off limits)',
    itemCount: 0,
    correctionCount: 0,
  },
  {
    id: 'place-never-password-vault',
    path: '~/1Password',
    canonicalPath: canonicalizePlacePath('~/1Password'),
    label: 'Password Manager Vaults',
    purpose: 'Encrypted password manager vaults and recovery kits',
    belongsHere: {
      fileTypes: ['opvault', 'kdbx', '1pux'],
      namePatterns: ['*.kdbx', '*.opvault'],
      keywords: ['1password', 'bitwarden', 'keepass', 'vault'],
    },
    allowedActions: [],
    status: 'never',
    allowContentIndexing: false,
    isDefaultNever: true,
    defaultNeverCategory: 'password_vault',
    folderFileId: 'fid-never-vault',
    lastScannedAtIso: 'Never scanned (Off limits)',
    itemCount: 0,
    correctionCount: 0,
  },
  {
    id: 'place-never-family-photos',
    path: '/Users/alex/Pictures/Family Photos',
    canonicalPath: canonicalizePlacePath('/Users/alex/Pictures/Family Photos'),
    label: 'Family Photos',
    purpose: 'Private family albums and personal memories — never touch or index',
    belongsHere: {
      fileTypes: ['jpg', 'png', 'heic', 'mov'],
      namePatterns: ['IMG_*', 'DSC_*', 'family*'],
      keywords: ['family', 'vacation', 'private photos'],
    },
    allowedActions: [],
    status: 'never',
    allowContentIndexing: false,
    isDefaultNever: false,
    defaultNeverCategory: 'user_custom',
    folderFileId: 'fid-never-family-photos',
    lastScannedAtIso: 'Never scanned (Off limits)',
    itemCount: 0,
    correctionCount: 0,
  },
];

export const INITIAL_USER_PLACES: PlaceRule[] = [
  {
    id: 'place-taxes',
    path: '/Users/alex/Documents/Taxes',
    canonicalPath: canonicalizePlacePath('/Users/alex/Documents/Taxes'),
    label: 'Taxes & Invoices',
    purpose: 'Where tax papers, W-2s, 1099s, and annual invoices go',
    belongsHere: {
      fileTypes: ['pdf', 'csv', 'xlsx'],
      namePatterns: ['*tax*', '*1099*', '*w2*', '*invoice*'],
      keywords: ['tax', 'irs', 'invoice', 'deduction', '1099', 'w2'],
    },
    allowedActions: ['read', 'add', 'move', 'rename'],
    status: 'allowed',
    allowContentIndexing: false,
    isDefaultNever: false,
    folderFileId: 'fid-folder-taxes-2026',
    lastScannedAtIso: '2026-10-31T20:15:00Z',
    itemCount: 14,
    correctionCount: 0,
  },
  {
    id: 'place-finance-2026',
    path: '/Users/alex/Documents/Finance/2026',
    canonicalPath: canonicalizePlacePath('/Users/alex/Documents/Finance/2026'),
    label: '2026 Receipts & Statements',
    purpose: 'Where monthly receipts, expense PDFs, and 2026 statements belong',
    belongsHere: {
      fileTypes: ['pdf', 'csv', 'png', 'jpg'],
      namePatterns: ['*receipt*', '*statement*', '*expense*', '2026-*'],
      keywords: ['receipt', 'expense', 'reimbursement', 'statement', 'october'],
    },
    allowedActions: ['read', 'add', 'move', 'rename'],
    status: 'allowed',
    allowContentIndexing: true,
    isDefaultNever: false,
    folderFileId: 'fid-folder-finance-2026',
    lastScannedAtIso: '2026-10-31T20:20:00Z',
    itemCount: 28,
    correctionCount: 1,
  },
  {
    id: 'place-travel-docs',
    path: '/Users/alex/Documents/Travel & IDs',
    canonicalPath: canonicalizePlacePath('/Users/alex/Documents/Travel & IDs'),
    label: 'Travel & Identity Scans',
    purpose: 'Where passport scans, visas, boarding passes, and Kyoto trip bookings live',
    belongsHere: {
      fileTypes: ['pdf', 'png', 'jpg', 'pkpass'],
      namePatterns: ['*passport*', '*visa*', '*ticket*', '*itinerary*', '*kyoto*'],
      keywords: ['passport', 'visa', 'flight', 'hotel', 'kyoto', 'boarding'],
    },
    allowedActions: ['read'],
    status: 'ask_first',
    allowContentIndexing: false,
    isDefaultNever: false,
    folderFileId: 'fid-folder-travel-ids',
    lastScannedAtIso: '2026-10-31T19:45:00Z',
    itemCount: 9,
    correctionCount: 0,
  },
  {
    id: 'place-downloads-inbox',
    path: '/Users/alex/Downloads',
    canonicalPath: canonicalizePlacePath('/Users/alex/Downloads'),
    label: 'Downloads Inbox',
    purpose: 'Temporary landing zone for newly downloaded files waiting to be sorted',
    belongsHere: {
      fileTypes: ['pdf', 'zip', 'dmg', 'png', 'csv', 'md'],
      namePatterns: ['*'],
      keywords: ['download', 'inbox', 'unsorted', 'installer'],
    },
    allowedActions: ['read', 'add', 'move', 'rename'],
    status: 'allowed',
    allowContentIndexing: false,
    isDefaultNever: false,
    folderFileId: 'fid-folder-downloads',
    lastScannedAtIso: '2026-10-31T21:00:00Z',
    itemCount: 19,
    correctionCount: 0,
  },
  {
    id: 'place-projects-notes',
    path: '/Users/alex/Projects/WorkspaceNotes',
    canonicalPath: canonicalizePlacePath('/Users/alex/Projects/WorkspaceNotes'),
    label: 'Project Notes & Specs',
    purpose: 'Where markdown notes, architecture specs, and meeting summaries live',
    belongsHere: {
      fileTypes: ['md', 'txt', 'json'],
      namePatterns: ['*notes*', '*spec*', '*summary*', 'README*'],
      keywords: ['notes', 'architecture', 'design', 'summary', 'meeting'],
    },
    allowedActions: ['read', 'add', 'move', 'rename'],
    status: 'allowed',
    allowContentIndexing: true,
    isDefaultNever: false,
    folderFileId: 'fid-folder-project-notes',
    lastScannedAtIso: '2026-10-31T21:10:00Z',
    itemCount: 22,
    correctionCount: 0,
  },
  ...DEFAULT_NEVER_PLACES,
];

export const INITIAL_INDEXED_FILES: IndexedFileMetadata[] = [
  {
    fileId: 'file-passport-scan',
    name: 'alex_passport_scan_2026.pdf',
    extension: 'pdf',
    mimeCategory: 'document',
    sizeBytes: 1_420_800,
    modifiedAtIso: '2026-10-12T10:30:00Z',
    parentPlaceId: 'place-travel-docs',
    parentPath: '/Users/alex/Documents/Travel & IDs',
    isRecent: true,
  },
  {
    fileId: 'file-kyoto-rail',
    name: 'jr_pass_kyoto_itinerary.pdf',
    extension: 'pdf',
    mimeCategory: 'document',
    sizeBytes: 684_100,
    modifiedAtIso: '2026-10-25T14:15:00Z',
    parentPlaceId: 'place-travel-docs',
    parentPath: '/Users/alex/Documents/Travel & IDs',
    isRecent: true,
  },
  {
    fileId: 'file-tax-1099',
    name: '2025_form_1099_consolidated.pdf',
    extension: 'pdf',
    mimeCategory: 'document',
    sizeBytes: 912_400,
    modifiedAtIso: '2026-02-18T09:00:00Z',
    parentPlaceId: 'place-taxes',
    parentPath: '/Users/alex/Documents/Taxes',
    isRecent: false,
  },
  {
    fileId: 'file-invoice-q3',
    name: 'vendor_invoice_october_cloud.pdf',
    extension: 'pdf',
    mimeCategory: 'document',
    sizeBytes: 310_200,
    modifiedAtIso: '2026-10-19T16:40:00Z',
    parentPlaceId: 'place-taxes',
    parentPath: '/Users/alex/Documents/Taxes',
    isRecent: true,
  },
  {
    fileId: 'file-receipt-oct',
    name: 'receipt_october_hotel_deposit.pdf',
    extension: 'pdf',
    mimeCategory: 'document',
    sizeBytes: 245_000,
    modifiedAtIso: '2026-10-28T11:20:00Z',
    parentPlaceId: 'place-finance-2026',
    parentPath: '/Users/alex/Documents/Finance/2026',
    isRecent: true,
    allowedContentSnippet: 'Receipt #8841 - Kyoto Ryokan Deposit Paid October 2026',
  },
  {
    fileId: 'file-downloads-loose-receipt',
    name: 'receipt_cafe_espresso_2026_10_30.pdf',
    extension: 'pdf',
    mimeCategory: 'document',
    sizeBytes: 128_500,
    modifiedAtIso: '2026-10-30T08:45:00Z',
    parentPlaceId: 'place-downloads-inbox',
    parentPath: '/Users/alex/Downloads',
    isRecent: true,
  },
  {
    fileId: 'file-downloads-loose-tax',
    name: 'property_tax_assessment_2026.pdf',
    extension: 'pdf',
    mimeCategory: 'document',
    sizeBytes: 540_000,
    modifiedAtIso: '2026-10-29T17:10:00Z',
    parentPlaceId: 'place-downloads-inbox',
    parentPath: '/Users/alex/Downloads',
    isRecent: true,
  },
  {
    fileId: 'file-project-arch',
    name: 'places_guard_architecture_notes.md',
    extension: 'md',
    mimeCategory: 'document',
    sizeBytes: 18_420,
    modifiedAtIso: '2026-10-31T18:00:00Z',
    parentPlaceId: 'place-projects-notes',
    parentPath: '/Users/alex/Projects/WorkspaceNotes',
    isRecent: true,
    allowedContentSnippet: 'Architecture summary for My Places and PlacesGuard canonicalization.',
  },
];

// ============================================================================
// 4. PLACESGUARD: CENTRALIZED ACCESS CONTROL ACROSS ALL CALLERS
// ============================================================================

export type PlacesGuardCaller =
  | 'files_plugin'
  | 'workspace_tool'
  | 'skill'
  | 'scheduled_chore'
  | 'shell_command'
  | 'subagent'
  | 'connector';

export type PlacesGuardOperation =
  | 'read'
  | 'list'
  | 'search'
  | 'index'
  | 'mention'
  | 'add'
  | 'move'
  | 'rename'
  | 'delete';

export interface PlacesGuardRequest {
  caller: PlacesGuardCaller;
  operation: PlacesGuardOperation;
  targetPath: string;
  places: PlaceRule[];
  chosenRoots?: string[];
  canonicalizeOptions?: CanonicalizeOptions;
}

export interface PlacesGuardDecision {
  allowed: boolean;
  status: PlaceStatus;
  canonicalPath: string;
  matchedPlace?: PlaceRule;
  reason: string;
  /** Exact user-facing message when blocked by a Never rule */
  blockedMessage?: 'That folder is off limits';
  offerChangeRuleAction?: boolean;
  requiresReauthToAllow?: boolean;
}

const HARDCODED_NEVER_PATTERNS: RegExp[] = [
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /^\/etc(\/|$)/i,
  /^\/system(\/|$)/i,
  /^[a-z]:\/windows(\/|$)/i,
  /^[a-z]:\/program files(\s*\(x86\))?(\/|$)/i,
  /(^|\/)1password(\/|$)/i,
  /(^|\/)bitwarden(\/|$)/i,
  /(^|\/)keepass(\/|$)/i,
  /(^|\/)google-chrome(\/|$)/i,
  /(^|\/)keychains(\/|$)/i,
];

/**
 * Extracts potential paths from a shell command string so shell commands
 * cannot bypass PlacesGuard.
 */
export function extractPathsFromShellCommand(command: string): string[] {
  const tokens = command
    .split(/\s+/)
    .map((t) => t.replace(/^['"]|['";|&]+$/g, ''))
    .filter(Boolean);

  const candidates: string[] = [];
  for (const tok of tokens) {
    if (
      tok.startsWith('/') ||
      tok.startsWith('~/') ||
      tok === '~' ||
      tok.includes('..') ||
      tok.startsWith('\\\\') ||
      /^[a-zA-Z]:[\\/]/.test(tok) ||
      tok.includes('.ssh') ||
      tok.toLowerCase().includes('progra~') ||
      tok.toLowerCase().includes('system32')
    ) {
      candidates.push(tok);
    }
  }
  return candidates.length > 0 ? candidates : [command];
}

/**
 * PlacesGuard: Every file operation (files plugin, workspace tools, skills,
 * scheduled chores, shell commands, subagents, connectors touching disk)
 * passes through this single deterministic guard.
 *
 * Rules enforced in code:
 * 1. Canonicalize path first (`..`, symlinks/junctions, case, UNC, short names, drive roots).
 * 2. Deny beats allow: if any matching rule (or hardcoded default system/vault pattern) has status `'never'`,
 *    OR if an operation on a parent folder would touch a child `'never'` place, `'never'` wins unconditionally.
 * 3. Anything outside the chosen roots is `'never'`.
 * 4. Unknown folders inside chosen roots default to `'ask_first'`.
 * 5. When blocked by `'never'`, returns `blockedMessage: 'That folder is off limits'` and `offerChangeRuleAction: true`.
 */
export function evaluatePlacesGuard(req: PlacesGuardRequest): PlacesGuardDecision {
  const roots = (req.chosenRoots || DEFAULT_CHOSEN_ROOTS).map((r) =>
    canonicalizePlacePath(r, req.canonicalizeOptions)
  );

  // If caller is a shell command, inspect every path token referenced in the command
  if (req.caller === 'shell_command' && req.targetPath.includes(' ')) {
    const extracted = extractPathsFromShellCommand(req.targetPath);
    for (const candidatePath of extracted) {
      const subRes = evaluatePlacesGuard({
        ...req,
        targetPath: candidatePath,
      });
      if (!subRes.allowed || subRes.status === 'never') {
        return subRes;
      }
    }
  }

  const canonical = canonicalizePlacePath(req.targetPath, req.canonicalizeOptions);

  // 1. Check all explicit 'never' rules FIRST (Deny beats allow!)
  const neverRules = req.places.filter((p) => p.status === 'never');
  for (const nr of neverRules) {
    const nrCanon = canonicalizePlacePath(nr.path, req.canonicalizeOptions);
    if (isPathInsideOrEqual(canonical, nrCanon)) {
      return {
        allowed: false,
        status: 'never',
        canonicalPath: canonical,
        matchedPlace: nr,
        reason: `Blocked by Never-Go Zone "${nr.label}" (${nr.path}). Deny overrides allow.`,
        blockedMessage: 'That folder is off limits',
        offerChangeRuleAction: true,
        requiresReauthToAllow: true,
      };
    }
  }

  // 2. Check hardcoded system/credential patterns (in case path is UNC or unmapped)
  for (const regex of HARDCODED_NEVER_PATTERNS) {
    if (regex.test(canonical)) {
      return {
        allowed: false,
        status: 'never',
        canonicalPath: canonical,
        reason: `Blocked by default system/credential protection on "${canonical}".`,
        blockedMessage: 'That folder is off limits',
        offerChangeRuleAction: true,
        requiresReauthToAllow: true,
      };
    }
  }

  // 3. Check if target is outside all chosen roots -> Anything outside chosen roots is Never!
  const insideAnyRoot = roots.some((rootCanon) => isPathInsideOrEqual(canonical, rootCanon));
  if (!insideAnyRoot) {
    return {
      allowed: false,
      status: 'never',
      canonicalPath: canonical,
      reason: `Path "${canonical}" is outside your chosen roots (${roots.join(', ')}). Anything outside chosen roots is Never.`,
      blockedMessage: 'That folder is off limits',
      offerChangeRuleAction: true,
      requiresReauthToAllow: true,
    };
  }

  // 4. Find the most specific matching non-never PlaceRule (longest canonicalPath match)
  const matchingRules = req.places
    .filter((p) => p.status !== 'never')
    .map((p) => ({
      place: p,
      canon: canonicalizePlacePath(p.path, req.canonicalizeOptions),
    }))
    .filter((item) => isPathInsideOrEqual(canonical, item.canon))
    .sort((a, b) => b.canon.length - a.canon.length);

  if (matchingRules.length === 0) {
    // Unknown folder inside chosen roots defaults to 'ask_first'
    return {
      allowed: false,
      status: 'ask_first',
      canonicalPath: canonical,
      reason: `Folder "${canonical}" is inside your chosen roots but has no Place rule yet — defaulting to Ask first.`,
    };
  }

  const bestMatch = matchingRules[0].place;

  if (bestMatch.status === 'ask_first') {
    return {
      allowed: false,
      status: 'ask_first',
      canonicalPath: canonical,
      matchedPlace: bestMatch,
      reason: `Place "${bestMatch.label}" is set to Ask first before ${req.operation}.`,
    };
  }

  // status === 'allowed': verify specific action permission for mutating operations
  const actionMap: Partial<Record<PlacesGuardOperation, PlaceAllowedAction>> = {
    read: 'read',
    list: 'read',
    search: 'read',
    index: 'read',
    mention: 'read',
    add: 'add',
    move: 'move',
    rename: 'rename',
    delete: 'delete',
  };
  const requiredAction = actionMap[req.operation] || 'read';

  if (!bestMatch.allowedActions.includes(requiredAction)) {
    return {
      allowed: false,
      status: 'ask_first',
      canonicalPath: canonical,
      matchedPlace: bestMatch,
      reason: `Place "${bestMatch.label}" is Allowed, but "${requiredAction}" is not in its allowed actions (${bestMatch.allowedActions.join(', ')}). Asking first.`,
    };
  }

  return {
    allowed: true,
    status: 'allowed',
    canonicalPath: canonical,
    matchedPlace: bestMatch,
    reason: `Allowed by Place "${bestMatch.label}" (${bestMatch.purpose}).`,
  };
}

/**
 * Re-authenticated rule change: changing a Place from `'never'` to `'allowed'` or `'ask_first'`
 * (or removing an item from the Default Never list) requires user re-authentication (PIN or biometric)
 * and records a warning if it was a default Never zone.
 */
export function changePlaceStatusWithReauth(params: {
  placeId: string;
  nextStatus: PlaceStatus;
  places: PlaceRule[];
  reauthPinOrBiometricPassed: boolean;
}): {
  ok: boolean;
  warningMessage?: string;
  updatedPlaces: PlaceRule[];
  error?: string;
} {
  const target = params.places.find((p) => p.id === params.placeId);
  if (!target) {
    return { ok: false, updatedPlaces: params.places, error: 'Place not found.' };
  }

  if (target.status === 'never' && params.nextStatus !== 'never') {
    if (!params.reauthPinOrBiometricPassed) {
      return {
        ok: false,
        updatedPlaces: params.places,
        error: 'Re-authentication required to change a Never place to Allowed or Ask first.',
      };
    }
  }

  const warningMessage =
    target.isDefaultNever && params.nextStatus !== 'never'
      ? `Warning: "${target.label}" (${target.path}) is on the Default Never list. Allowing access exposes sensitive system or credential files.`
      : undefined;

  const updatedPlaces = params.places.map((p) =>
    p.id === params.placeId
      ? {
          ...p,
          status: params.nextStatus,
          allowedActions:
            params.nextStatus === 'never'
              ? []
              : p.allowedActions.length > 0
                ? p.allowedActions
                : (['read'] as PlaceAllowedAction[]),
        }
      : p
  );

  return {
    ok: true,
    warningMessage,
    updatedPlaces,
  };
}

/**
 * Ensures a Never place's path or files never appear in the exported map snippets,
 * logs, or model prompts.
 */
export function buildSafeModelPlacesSnippet(
  places: PlaceRule[],
  indexedFiles: IndexedFileMetadata[]
): string {
  const safePlaces = places.filter((p) => p.status !== 'never');
  const neverIds = new Set(places.filter((p) => p.status === 'never').map((p) => p.id));
  const safeFiles = indexedFiles.filter((f) => !neverIds.has(f.parentPlaceId));

  const lines = safePlaces.map(
    (p) =>
      `- ${p.label} [${p.status.toUpperCase()}]: ${p.purpose} (Types: ${p.belongsHere.fileTypes.join(', ')})`
  );
  const sampleFiles = safeFiles.slice(0, 6).map((f) => `  * ${f.name} (${f.parentPath})`);

  return [...lines, ...sampleFiles].join('\n');
}

// ============================================================================
// 5. BUILD THE MAP: READ-ONLY METADATA INDEXER & FILESYSTEMBRIDGE
// ============================================================================

export interface RawDirectoryEntryFixture {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  sizeBytes?: number;
  modifiedAtIso?: string;
  folderFileId?: string;
  /** Raw file text present on disk — indexer MUST NOT read this unless allowContentIndexing is true on an Allowed place */
  rawDiskContent?: string;
}

export interface FileSystemBridge {
  readonly bridgeKind: 'browser_fs_access_api' | 'desktop_shell_native';
  readonly limitationNotice: string;
  scanMetadataOnly(
    entries: RawDirectoryEntryFixture[],
    places: PlaceRule[],
    chosenRoots: string[]
  ): {
    indexedFiles: IndexedFileMetadata[];
    skippedNeverCount: number;
    contentReadsPerformed: number;
  };
}

export const BROWSER_FILE_SYSTEM_BRIDGE: FileSystemBridge = {
  bridgeKind: 'browser_fs_access_api',
  limitationNotice:
    'Uses the browser File System Access API (showDirectoryPicker, Chromium only). Browsers limit which system and user folders can be opened; the desktop shell adds full access behind this same FileSystemBridge interface.',
  scanMetadataOnly(entries, places, chosenRoots) {
    const indexedFiles: IndexedFileMetadata[] = [];
    let skippedNeverCount = 0;
    let contentReadsPerformed = 0;

    for (const entry of entries) {
      if (entry.kind !== 'file') continue;

      const guard = evaluatePlacesGuard({
        caller: 'files_plugin',
        operation: 'index',
        targetPath: entry.path,
        places,
        chosenRoots,
      });

      // Never place blocks reading, listing, searching, indexing, and mentioning!
      if (guard.status === 'never') {
        skippedNeverCount += 1;
        continue;
      }

      const ext = entry.name.includes('.')
        ? entry.name.split('.').pop()!.toLowerCase()
        : '';
      const mimeCategory: IndexedFileMetadata['mimeCategory'] =
        ['pdf', 'md', 'txt', 'doc', 'docx'].includes(ext)
          ? 'document'
          : ['csv', 'xlsx', 'xls'].includes(ext)
            ? 'spreadsheet'
            : ['png', 'jpg', 'jpeg', 'webp', 'svg', 'heic'].includes(ext)
              ? 'image'
              : ['zip', 'tar', 'gz', 'dmg'].includes(ext)
                ? 'archive'
                : ['ts', 'tsx', 'js', 'py', 'json'].includes(ext)
                  ? 'code'
                  : 'other';

      // NEVER read file contents unless the user explicitly allowed it for this specific place
      let allowedContentSnippet: string | undefined = undefined;
      if (
        guard.matchedPlace &&
        guard.matchedPlace.status === 'allowed' &&
        guard.matchedPlace.allowContentIndexing &&
        entry.rawDiskContent
      ) {
        allowedContentSnippet = entry.rawDiskContent.slice(0, 140);
        contentReadsPerformed += 1;
      }

      const parentPath = canonicalizePlacePath(
        entry.path.split(/[/\\]/).slice(0, -1).join('/') || '/'
      );

      indexedFiles.push({
        fileId: `idx-${computeDeterministicHash(entry.path).slice(0, 10)}`,
        name: entry.name,
        extension: ext,
        mimeCategory,
        sizeBytes: entry.sizeBytes ?? 0,
        modifiedAtIso: entry.modifiedAtIso ?? new Date().toISOString(),
        parentPlaceId: guard.matchedPlace?.id || 'unmapped-place',
        parentPath,
        isRecent: true,
        allowedContentSnippet,
      });
    }

    return {
      indexedFiles,
      skippedNeverCount,
      contentReadsPerformed,
    };
  },
};

// ============================================================================
// 6. MAP FRESHNESS & MAP HEALTH (RENAME DETECTION BY FILE ID / HASH)
// ============================================================================

export interface DiskFolderSnapshotItem {
  path: string;
  folderFileId: string;
  exists: boolean;
  itemCount: number;
}

export interface MapHealthIssue {
  placeId: string;
  placeLabel: string;
  kind: 'renamed_or_moved' | 'missing_folder' | 'stale_rule';
  detail: string;
  oldPath: string;
  detectedNewPath?: string;
}

export interface MapHealthReport {
  healthyCount: number;
  totalTrackedPlaces: number;
  issues: MapHealthIssue[];
  healedPlaces: PlaceRule[];
  lastCheckedAtIso: string;
}

/**
 * Checks map freshness against current folders on disk:
 * - Detects moved or renamed folders by matching `folderFileId` (or content hash) and heals their paths
 * - Flags missing folders or stale rules (> 30 days since scan)
 */
export function evaluateMapHealthAndHealRenames(
  places: PlaceRule[],
  diskSnapshots: DiskFolderSnapshotItem[],
  nowIso = '2026-10-31T22:00:00Z'
): MapHealthReport {
  const issues: MapHealthIssue[] = [];
  const byFileId = new Map<string, DiskFolderSnapshotItem>();
  const byCanonPath = new Map<string, DiskFolderSnapshotItem>();

  for (const snap of diskSnapshots) {
    byFileId.set(snap.folderFileId, snap);
    byCanonPath.set(canonicalizePlacePath(snap.path), snap);
  }

  const healedPlaces = places.map((place) => {
    if (place.status === 'never') return place;

    const currentCanon = canonicalizePlacePath(place.path);
    const exactMatch = byCanonPath.get(currentCanon);

    if (exactMatch && exactMatch.exists) {
      return {
        ...place,
        itemCount: exactMatch.itemCount,
        lastScannedAtIso: nowIso,
      };
    }

    // Folder not at old path — check if it was moved or renamed by matching `folderFileId`
    const movedSnap = byFileId.get(place.folderFileId);
    if (movedSnap && movedSnap.exists) {
      issues.push({
        placeId: place.id,
        placeLabel: place.label,
        kind: 'renamed_or_moved',
        detail: `Detected folder rename/move via folder ID (${place.folderFileId}): "${place.path}" → "${movedSnap.path}". Updated rule path automatically.`,
        oldPath: place.path,
        detectedNewPath: movedSnap.path,
      });
      return {
        ...place,
        path: movedSnap.path,
        canonicalPath: canonicalizePlacePath(movedSnap.path),
        itemCount: movedSnap.itemCount,
        lastScannedAtIso: nowIso,
      };
    }

    // Missing on disk
    issues.push({
      placeId: place.id,
      placeLabel: place.label,
      kind: 'missing_folder',
      detail: `Folder "${place.path}" was not found during rescan.`,
      oldPath: place.path,
    });
    return place;
  });

  const trackedNonNever = healedPlaces.filter((p) => p.status !== 'never');
  const healthyCount = Math.max(0, trackedNonNever.length - issues.filter((i) => i.kind === 'missing_folder').length);

  return {
    healthyCount,
    totalTrackedPlaces: trackedNonNever.length,
    issues,
    healedPlaces,
    lastCheckedAtIso: nowIso,
  };
}

// ============================================================================
// 7. TEACH IT THREE WAYS (DESCRIBE, RECORD, SNAP) + CORRECTIONS
// ============================================================================

export type PlaceTeachingMethod = 'describe' | 'record' | 'snap' | 'correction';

export interface PlaceRuleProposal {
  proposalId: string;
  method: PlaceTeachingMethod;
  summary: string;
  replacesPlaceId?: string;
  proposedRule: PlaceRule;
  zodValidated: boolean;
}

/**
 * 1. DESCRIBE:
 * e.g. "My tax papers live in Documents/Taxes. Never touch Family Photos."
 * Compiles natural language into Zod-validated PlaceRule proposals with visual confirmation.
 */
export function compileDescribeToPlaceProposals(
  naturalDescription: string
): PlaceRuleProposal[] {
  const sentences = naturalDescription
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const proposals: PlaceRuleProposal[] = [];

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();

    // Detect "Never touch <Folder>" or "Stay out of <Folder>"
    const neverMatch = sentence.match(
      /(?:never\s+touch|never\s+go\s+to|stay\s+out\s+of|off\s+limits:?)\s+([A-Za-z0-9_./~\s-]+?)(?:[.!]|$)/i
    );
    if (neverMatch) {
      const rawFolder = neverMatch[1].trim();
      const fullPath = rawFolder.startsWith('/') || rawFolder.startsWith('~')
        ? rawFolder
        : `/Users/alex/Pictures/${rawFolder}`;
      const candidate: PlaceRule = {
        id: `place-prop-${computeDeterministicHash(fullPath).slice(0, 8)}`,
        path: fullPath,
        canonicalPath: canonicalizePlacePath(fullPath),
        label: rawFolder,
        purpose: `Off-limits folder ("${sentence}") — never read, list, or index`,
        belongsHere: {
          fileTypes: [],
          namePatterns: ['*'],
          keywords: [rawFolder.toLowerCase()],
        },
        allowedActions: [],
        status: 'never',
        allowContentIndexing: false,
        isDefaultNever: false,
        defaultNeverCategory: 'user_custom',
        folderFileId: `fid-${computeDeterministicHash(fullPath).slice(0, 8)}`,
        lastScannedAtIso: 'Never scanned (Off limits)',
        itemCount: 0,
        correctionCount: 0,
      };
      const parsed = PlaceRuleSchema.safeParse(candidate);
      if (parsed.success) {
        proposals.push({
          proposalId: `prop-desc-${proposals.length + 1}`,
          method: 'describe',
          summary: `Mark "${rawFolder}" (${fullPath}) as Never (off limits)`,
          proposedRule: parsed.data,
          zodValidated: true,
        });
      }
      continue;
    }

    // Detect "<Subject> live/go/belong in <Folder>"
    const liveInMatch = sentence.match(
      /(?:my\s+)?([A-Za-z0-9_\s&-]+?)\s+(?:live|lives|go|goes|belong|belongs|are\s+kept)\s+in\s+([A-Za-z0-9_./~\s-]+?)(?:[.!]|$)/i
    );
    if (liveInMatch) {
      const subject = liveInMatch[1].trim();
      const rawFolder = liveInMatch[2].trim();
      const fullPath =
        rawFolder.startsWith('/') || rawFolder.startsWith('~')
          ? rawFolder
          : `/Users/alex/${rawFolder}`;
      const keywords = subject
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2 && !['papers', 'files', 'things'].includes(w));
      const candidate: PlaceRule = {
        id: `place-prop-${computeDeterministicHash(fullPath).slice(0, 8)}`,
        path: fullPath,
        canonicalPath: canonicalizePlacePath(fullPath),
        label: rawFolder.split('/').pop() || rawFolder,
        purpose: `Where ${subject.toLowerCase()} go`,
        belongsHere: {
          fileTypes: lower.includes('photo') ? ['jpg', 'png'] : ['pdf', 'csv', 'docx'],
          namePatterns: keywords.map((k) => `*${k}*`),
          keywords: keywords.length > 0 ? keywords : [subject.toLowerCase()],
        },
        allowedActions: ['read', 'add', 'move', 'rename'],
        status: 'allowed',
        allowContentIndexing: false,
        isDefaultNever: false,
        folderFileId: `fid-${computeDeterministicHash(fullPath).slice(0, 8)}`,
        lastScannedAtIso: new Date().toISOString(),
        itemCount: 0,
        correctionCount: 0,
      };
      const parsed = PlaceRuleSchema.safeParse(candidate);
      if (parsed.success) {
        proposals.push({
          proposalId: `prop-desc-${proposals.length + 1}`,
          method: 'describe',
          summary: `Map "${candidate.label}" (${fullPath}) -> "${candidate.purpose}" [Allowed]`,
          proposedRule: parsed.data,
          zodValidated: true,
        });
      }
    }
  }

  return proposals;
}

export interface ExplorerRecordingKeyframe {
  keyframeId: string;
  folderPath: string;
  narrationText: string;
  selectedForModel: boolean;
  blurredPrivateRegions: boolean;
}

/**
 * 2. RECORD:
 * The user narrates while browsing their file explorer. Reviews keyframes & transcript,
 * blurs private regions, and sends ONLY selected keyframes to propose places & purposes.
 */
export function compileRecordedExplorerSessionToProposals(
  keyframes: ExplorerRecordingKeyframe[]
): {
  sentKeyframeIds: string[];
  excludedKeyframeIds: string[];
  proposals: PlaceRuleProposal[];
} {
  const sentKeyframeIds: string[] = [];
  const excludedKeyframeIds: string[] = [];
  const proposals: PlaceRuleProposal[] = [];

  for (const kf of keyframes) {
    if (!kf.selectedForModel) {
      excludedKeyframeIds.push(kf.keyframeId);
      continue;
    }
    sentKeyframeIds.push(kf.keyframeId);
    const fromText = compileDescribeToPlaceProposals(kf.narrationText);
    if (fromText.length > 0) {
      for (const p of fromText) {
        proposals.push({
          ...p,
          proposalId: `prop-rec-${kf.keyframeId}`,
          method: 'record',
          summary: `[From Recorded Keyframe ${kf.keyframeId}${kf.blurredPrivateRegions ? ' · Privacy Blurred' : ''}] ${p.summary}`,
        });
      }
    } else {
      const folderLabel = kf.folderPath.split('/').pop() || 'Folder';
      const candidate: PlaceRule = {
        id: `place-rec-${computeDeterministicHash(kf.folderPath).slice(0, 8)}`,
        path: kf.folderPath,
        canonicalPath: canonicalizePlacePath(kf.folderPath),
        label: folderLabel,
        purpose: kf.narrationText || `Where ${folderLabel} files belong`,
        belongsHere: {
          fileTypes: ['pdf', 'md', 'csv'],
          namePatterns: [`*${folderLabel.toLowerCase()}*`],
          keywords: [folderLabel.toLowerCase()],
        },
        allowedActions: ['read', 'add', 'move'],
        status: 'allowed',
        allowContentIndexing: false,
        isDefaultNever: false,
        folderFileId: `fid-${computeDeterministicHash(kf.folderPath).slice(0, 8)}`,
        lastScannedAtIso: new Date().toISOString(),
        itemCount: 0,
        correctionCount: 0,
      };
      const parsed = PlaceRuleSchema.safeParse(candidate);
      if (parsed.success) {
        proposals.push({
          proposalId: `prop-rec-${kf.keyframeId}`,
          method: 'record',
          summary: `[Recorded Keyframe] "${folderLabel}" (${kf.folderPath}) -> ${candidate.purpose}`,
          proposedRule: parsed.data,
          zodValidated: true,
        });
      }
    }
  }

  return { sentKeyframeIds, excludedKeyframeIds, proposals };
}

/**
 * 3. SNAP:
 * Vision extracts folder names and labels from a photo/screenshot of a folder window,
 * a list, or a hand-drawn sketch of how the user organizes things.
 */
export function compileSnapSketchToPlaceProposals(snapInput: {
  sourceKind: 'folder_window_screenshot' | 'hand_drawn_sketch' | 'folder_list_photo';
  extractedLines: Array<{ folderPathOrName: string; handwrittenNote: string; statusHint?: PlaceStatus }>;
}): PlaceRuleProposal[] {
  return snapInput.extractedLines.map((line, idx) => {
    const fullPath =
      line.folderPathOrName.startsWith('/') || line.folderPathOrName.startsWith('~')
        ? line.folderPathOrName
        : `/Users/alex/Documents/${line.folderPathOrName}`;
    const label = line.folderPathOrName.split('/').pop() || line.folderPathOrName;
    const status: PlaceStatus =
      line.statusHint ||
      (line.handwrittenNote.toLowerCase().includes('never') ? 'never' : 'allowed');
    const keywords = line.handwrittenNote
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 2 && !['where', 'for', 'and', 'the', 'goes'].includes(w));

    const rule: PlaceRule = PlaceRuleSchema.parse({
      id: `place-snap-${computeDeterministicHash(fullPath).slice(0, 8)}`,
      path: fullPath,
      canonicalPath: canonicalizePlacePath(fullPath),
      label,
      purpose: line.handwrittenNote,
      belongsHere: {
        fileTypes: ['pdf', 'png', 'jpg', 'md', 'csv'],
        namePatterns: keywords.slice(0, 3).map((k) => `*${k}*`),
        keywords: keywords.length > 0 ? keywords : [label.toLowerCase()],
      },
      allowedActions: status === 'never' ? [] : ['read', 'add', 'move', 'rename'],
      status,
      allowContentIndexing: false,
      isDefaultNever: false,
      folderFileId: `fid-snap-${idx + 1}`,
      lastScannedAtIso: new Date().toISOString(),
      itemCount: 0,
      correctionCount: 0,
    });

    return {
      proposalId: `prop-snap-${idx + 1}`,
      method: 'snap',
      summary: `[Snap: ${snapInput.sourceKind.replace(/_/g, ' ')}] "${label}" (${fullPath}) -> "${line.handwrittenNote}"`,
      proposedRule: rule,
      zodValidated: true,
    };
  });
}

/**
 * 4. CORRECTIONS ARE TEACHING:
 * e.g. "No, receipts go in Finance/2026"
 * Updates or proposes a rule when it changes an existing rule.
 * Repeated corrections (>= 2) flag `promoteToReviewInbox: true`.
 */
export function applyUserPlaceCorrection(
  correctionText: string,
  existingPlaces: PlaceRule[]
): {
  recognized: boolean;
  isChangingExistingRule: boolean;
  promoteToReviewInbox: boolean;
  proposal?: PlaceRuleProposal;
} {
  const match = correctionText.match(
    /(?:no,\s*)?([A-Za-z0-9_\s-]+?)\s+(?:go|goes|belong|belongs)\s+in\s+([A-Za-z0-9_./~\s-]+?)(?:[.!]|$)/i
  );
  if (!match) {
    return {
      recognized: false,
      isChangingExistingRule: false,
      promoteToReviewInbox: false,
    };
  }

  const keywordRaw = match[1].trim().toLowerCase();
  const singularKeyword = keywordRaw.endsWith('s') ? keywordRaw.slice(0, -1) : keywordRaw;
  const folderRaw = match[2].trim();
  const fullPath =
    folderRaw.startsWith('/') || folderRaw.startsWith('~')
      ? folderRaw
      : `/Users/alex/Documents/${folderRaw}`;
  const canon = canonicalizePlacePath(fullPath);

  // Check if an existing place matches this folder or already claims this keyword
  const existingTarget = existingPlaces.find(
    (p) =>
      canonicalizePlacePath(p.path) === canon ||
      p.belongsHere.keywords.includes(singularKeyword) ||
      p.belongsHere.keywords.includes(keywordRaw)
  );

  const nextCorrectionCount = (existingTarget?.correctionCount ?? 0) + 1;
  const proposedRule: PlaceRule = PlaceRuleSchema.parse({
    id: existingTarget?.id || `place-corr-${computeDeterministicHash(fullPath).slice(0, 8)}`,
    path: fullPath,
    canonicalPath: canon,
    label: existingTarget?.label || folderRaw.split('/').pop() || folderRaw,
    purpose: `Where ${keywordRaw} go (Updated from your correction)`,
    belongsHere: {
      fileTypes: existingTarget?.belongsHere.fileTypes || ['pdf', 'csv', 'png', 'jpg'],
      namePatterns: Array.from(
        new Set([...(existingTarget?.belongsHere.namePatterns || []), `*${singularKeyword}*`])
      ),
      keywords: Array.from(
        new Set([...(existingTarget?.belongsHere.keywords || []), singularKeyword, keywordRaw])
      ),
    },
    allowedActions: existingTarget?.allowedActions || ['read', 'add', 'move', 'rename'],
    status: existingTarget?.status === 'never' ? 'ask_first' : (existingTarget?.status || 'allowed'),
    allowContentIndexing: existingTarget?.allowContentIndexing ?? false,
    isDefaultNever: false,
    folderFileId: existingTarget?.folderFileId || `fid-${computeDeterministicHash(fullPath).slice(0, 8)}`,
    lastScannedAtIso: new Date().toISOString(),
    itemCount: existingTarget?.itemCount ?? 0,
    correctionCount: nextCorrectionCount,
  });

  return {
    recognized: true,
    isChangingExistingRule: Boolean(existingTarget),
    promoteToReviewInbox: nextCorrectionCount >= 2,
    proposal: {
      proposalId: `prop-corr-${Date.now()}`,
      method: 'correction',
      replacesPlaceId: existingTarget?.id,
      summary: `Update Place rule: route "${keywordRaw}" to ${fullPath} (${proposedRule.label})`,
      proposedRule,
      zodValidated: true,
    },
  };
}

// ============================================================================
// 8. GET AND PUT: places.find(intent) & places.suggest_destination(file) + UNDO
// ============================================================================

export interface PlaceFindCandidate {
  file: IndexedFileMetadata;
  place: PlaceRule;
  confidence: number;
  reason: string;
  matchSource: 'filename' | 'map_purpose' | 'recent' | 'allowed_content';
}

export interface PlacesFindResult {
  intent: string;
  unsureShowOptions: boolean;
  candidates: PlaceFindCandidate[];
}

/**
 * `places.find(intent)`:
 * e.g. 'find my passport scan' -> returns ranked candidates with a reason and confidence,
 * from the map, recents, and name search (content search ONLY where allowed).
 * Never searches or returns anything from a Never place.
 */
export function placesFind(
  intent: string,
  indexedFiles: IndexedFileMetadata[],
  places: PlaceRule[]
): PlacesFindResult {
  const placeById = new Map<string, PlaceRule>(places.map((p) => [p.id, p]));
  const queryTokens = intent
    .toLowerCase()
    .replace(/\b(find|where|is|my|the|a|an|locate|open|show|me)\b/g, ' ')
    .split(/\W+/)
    .filter((t) => t.length >= 2);

  const candidates: PlaceFindCandidate[] = [];

  for (const file of indexedFiles) {
    const place = placeById.get(file.parentPlaceId);
    // Never place is strictly excluded from find()
    if (!place || place.status === 'never') continue;

    const nameLower = file.name.toLowerCase();
    const purposeLower = `${place.label} ${place.purpose} ${place.belongsHere.keywords.join(' ')}`.toLowerCase();
    const contentLower =
      place.allowContentIndexing && file.allowedContentSnippet
        ? file.allowedContentSnippet.toLowerCase()
        : '';

    let score = 0;
    const matchedReasons: string[] = [];
    let primarySource: PlaceFindCandidate['matchSource'] = 'map_purpose';

    const nameHits = queryTokens.filter((tok) => nameLower.includes(tok));
    if (nameHits.length > 0) {
      score += 0.55 + Math.min(0.3, nameHits.length * 0.15);
      matchedReasons.push(`File name matches "${nameHits.join(', ')}"`);
      primarySource = 'filename';
    }

    const purposeHits = queryTokens.filter((tok) => purposeLower.includes(tok));
    if (purposeHits.length > 0) {
      score += 0.25;
      matchedReasons.push(`Located in "${place.label}" (${place.purpose})`);
    }

    if (contentLower) {
      const contentHits = queryTokens.filter((tok) => contentLower.includes(tok));
      if (contentHits.length > 0) {
        score += 0.2;
        matchedReasons.push(`Allowed content snippet matches "${contentHits.join(', ')}"`);
        if (primarySource !== 'filename') primarySource = 'allowed_content';
      }
    }

    if (file.isRecent && score > 0) {
      score += 0.08;
      matchedReasons.push('Recently modified');
    }

    if (score > 0) {
      const confidence = Number(Math.min(0.99, score).toFixed(2));
      candidates.push({
        file,
        place,
        confidence,
        reason: matchedReasons.join(' · '),
        matchSource: primarySource,
      });
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const topConfidence = candidates[0]?.confidence ?? 0;

  return {
    intent,
    unsureShowOptions: candidates.length === 0 || topConfidence < 0.7 || (candidates.length > 1 && topConfidence - candidates[1].confidence < 0.12),
    candidates,
  };
}

export interface SuggestDestinationCandidate {
  place: PlaceRule;
  confidence: number;
  reason: string;
  canAutoMoveInChore: boolean;
  requiresAsk: boolean;
}

export interface PlacesSuggestDestinationResult {
  fileName: string;
  topSuggestion?: SuggestDestinationCandidate;
  alternatives: SuggestDestinationCandidate[];
}

/**
 * `places.suggest_destination(file)`:
 * Proposes where a file belongs from the rules (type, name patterns, keywords, past corrections).
 * If confident (>= 0.8) and the place is Allowed (with 'move' action), a chore may move it; otherwise ask.
 */
export function placesSuggestDestination(
  fileInput: { name: string; sizeBytes?: number },
  places: PlaceRule[]
): PlacesSuggestDestinationResult {
  const nameLower = fileInput.name.toLowerCase();
  const ext = nameLower.includes('.') ? nameLower.split('.').pop()! : '';

  const scored: SuggestDestinationCandidate[] = [];

  for (const place of places) {
    // Never suggest moving a file into a Never place or back into Downloads inbox
    if (place.status === 'never' || place.id === 'place-downloads-inbox') continue;

    let score = 0;
    const reasons: string[] = [];

    // 1. Check keywords
    const matchedKeywords = place.belongsHere.keywords.filter((kw) =>
      nameLower.includes(kw.toLowerCase())
    );
    if (matchedKeywords.length > 0) {
      score += 0.55 + Math.min(0.25, matchedKeywords.length * 0.12);
      reasons.push(`Matches keyword "${matchedKeywords.join(', ')}"`);
    }

    // 2. Check wildcard namePatterns
    const matchedPatterns = place.belongsHere.namePatterns.filter((pat) => {
      if (pat === '*') return false;
      const clean = pat.replace(/\*/g, '').toLowerCase();
      return clean.length > 0 && nameLower.includes(clean);
    });
    if (matchedPatterns.length > 0) {
      score += 0.2;
      reasons.push(`Matches pattern ${matchedPatterns.join(', ')}`);
    }

    // 3. Check file extension
    if (ext && place.belongsHere.fileTypes.map((t) => t.toLowerCase()).includes(ext)) {
      score += 0.15;
      reasons.push(`Accepts .${ext} files`);
    }

    // 4. Boost if updated by past user correction
    if (score > 0 && place.correctionCount > 0) {
      score += 0.12;
      reasons.push(`Reinforced by your past correction`);
    }

    if (score > 0) {
      const confidence = Number(Math.min(0.99, score).toFixed(2));
      const canAutoMoveInChore =
        confidence >= 0.8 &&
        place.status === 'allowed' &&
        place.allowedActions.includes('move');
      scored.push({
        place,
        confidence,
        reason: `${reasons.join(' · ')} (${place.purpose})`,
        canAutoMoveInChore,
        requiresAsk: !canAutoMoveInChore,
      });
    }
  }

  scored.sort((a, b) => b.confidence - a.confidence);

  return {
    fileName: fileInput.name,
    topSuggestion: scored[0],
    alternatives: scored.slice(1),
  };
}

export interface PlacesMoveJournalEntry {
  entryId: string;
  fileName: string;
  fromPath: string;
  toPath: string;
  destinationPlaceId: string;
  destinationPlaceLabel: string;
  movedAtIso: string;
  operation: 'move_never_delete';
  undone: boolean;
  undoneAtIso?: string;
}

/**
 * Every move goes in a reversible PlacesUndoJournal (move, never delete; keep a log)
 * with one-click Undo.
 */
export class PlacesUndoJournal {
  private entries: PlacesMoveJournalEntry[] = [];

  recordMove(params: {
    fileName: string;
    fromFolder: string;
    destinationPlace: PlaceRule;
  }): PlacesMoveJournalEntry {
    const entry: PlacesMoveJournalEntry = {
      entryId: `pundo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fileName: params.fileName,
      fromPath: `${params.fromFolder.replace(/\/+$/, '')}/${params.fileName}`,
      toPath: `${params.destinationPlace.path.replace(/\/+$/, '')}/${params.fileName}`,
      destinationPlaceId: params.destinationPlace.id,
      destinationPlaceLabel: params.destinationPlace.label,
      movedAtIso: new Date().toISOString(),
      operation: 'move_never_delete',
      undone: false,
    };
    this.entries = [entry, ...this.entries];
    return entry;
  }

  undoMove(entryId: string): { ok: boolean; entry?: PlacesMoveJournalEntry; summary: string } {
    const target = this.entries.find((e) => e.entryId === entryId);
    if (!target || target.undone) {
      return { ok: false, summary: 'Move entry not found or already undone.' };
    }
    target.undone = true;
    target.undoneAtIso = new Date().toISOString();
    return {
      ok: true,
      entry: { ...target },
      summary: `Restored "${target.fileName}" back to ${target.fromPath}.`,
    };
  }

  getEntries(): PlacesMoveJournalEntry[] {
    return [...this.entries];
  }
}
