/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Connectors SDK & Everyday Scheduler Module
 *
 * 1. CONNECTOR SDK
 * - Strict manifest: id, name, icon, authType, scopes, tools with read/write risk,
 *   rateLimits, healthCheck, writeRequiresApproval, boundProjectIds, setupGuide (3-step).
 * - Honest status: 'connected' ONLY when real test call succeeded. Otherwise 'needs_setup', 'error', 'simulated'.
 * - SSRF protection & host allowlist for server proxy.
 * - Read tools run freely; write tools require approval per the Rule Book.
 * - Real implementations + recorded test fixtures for all 18 connectors:
 *   - No account: Weather (Open-Meteo), Web pages, RSS/Atom, Calendar (ICS), Wikipedia, Local folder, Web search
 *   - Token/key: GitHub, Telegram, Slack, Discord webhook, Notion, Linear, Todoist, Home Assistant
 *   - OAuth: Google Workspace, Microsoft 365
 *   - Universal: MCP connector (URL + auth, tool discovery)
 *
 * 2. EVERYDAY SCHEDULER
 * - Device clock and time zone for all scheduling & display ('Tomorrow, 8:00 AM').
 * - Handles DST, timezone shifts, clock adjustments, and sleep/wake re-evaluation.
 * - Hides cron strings, UTC timestamps, and IDs behind 'Advanced'.
 * - 4-step create flow: 1) What to do, 2) When (quick pills + time picker + natural language), 3) Remind vs Do, 4) How to tell me.
 * - 7 Neutral templates.
 * - Missed runs policy: 'run_when_back', 'skip', 'ask_me'.
 * - Purely read/draft authority; unattended money actions strictly blocked.
 * - Honest disclosure: Blaize must be open for schedules to run in this version.
 */

import { ScopedApprovalToken } from '../contracts';
import { ScopedRuleItem } from '../hub/index';
import { globalApprovalTokenStore, globalPolicyEngine } from '../trust';
import {
  CONNECTOR_PROVIDER_ADAPTERS,
  ConnectorEvidenceClass,
  ConnectorHttpTransport,
  getConnectorProviderAdapter,
} from './provider_adapters';
import {
  computeNextRunsInTimeZone,
  isValidIanaTimeZone,
  parseCronExpression,
} from './cron_and_scheduler';

export * from './provider_adapters';
export * from './cron_and_scheduler';

// ============================================================================
// 1. CONNECTOR SDK INTERFACES & MANIFEST TYPES
// ============================================================================

export type ConnectorAuthType = 'none' | 'api_key' | 'bearer' | 'oauth_pkce' | 'mcp';

export type ConnectorStatus =
  | 'connected'
  | 'needs_setup'
  | 'not_configured'
  | 'unsupported'
  | 'error'
  | 'simulated';

export type ConnectorCategory =
  | 'no_account'
  | 'token_or_key'
  | 'oauth_pkce'
  | 'universal_mcp';

export interface ConnectorTool {
  name: string;
  description: string;
  risk: 'read' | 'write';
  rateLimit: {
    requestsPerMinute: number;
  };
}

export interface ConnectorManifest {
  id: string;
  name: string;
  icon: string;
  category: ConnectorCategory;
  authType: ConnectorAuthType;
  status: ConnectorStatus;
  adapterImplemented?: boolean;
  evidenceClass?: ConnectorEvidenceClass;
  errorMessage?: string;
  setupGuide: [string, string, string]; // Exactly 3-step guide
  scopes: string[];
  tools: ConnectorTool[];
  rateLimits: {
    requestsPerMinute: number;
  };
  healthCheck: {
    endpoint: string;
    method?: 'GET' | 'POST';
    description: string;
  };
  writeRequiresApproval: boolean;
  boundProjectIds: string[];
  credentialsConfigured: boolean;
  lastTestedAt?: string;
  lastTestStatus?: 'ok' | 'failed';
  lastTestSummary?: string;
  customEndpointUrl?: string;
  customAuthHeader?: string;
}

export interface ConnectorInvocationResult {
  ok: boolean;
  toolName: string;
  risk: 'read' | 'write';
  status:
    | 'executed'
    | 'simulated'
    | 'needs_approval'
    | 'blocked_by_rule'
    | 'not_configured'
    | 'failed';
  evidenceClass?: ConnectorEvidenceClass;
  isSimulated?: boolean;
  output?: unknown;
  error?: string;
  recordedInLedger: boolean;
  ledgerRef?: string;
}

// ============================================================================
// 2. SSRF PROTECTION & HOST ALLOWLIST
// ============================================================================

export const ALLOWLISTED_CONNECTOR_HOSTS = new Set([
  'api.open-meteo.com',
  'en.wikipedia.org',
  'api.github.com',
  'api.telegram.org',
  'slack.com',
  'discord.com',
  'api.notion.com',
  'api.linear.app',
  'api.todoist.com',
  'www.googleapis.com',
  'accounts.google.com',
  'graph.microsoft.com',
  'login.microsoftonline.com',
]);

const BLOCKED_IP_PREFIXES = [
  '127.',
  '10.',
  '192.168.',
  '169.254.', // Cloud metadata
  '0.0.0.0',
  '::1',
  'fc00:',
  'fe80:',
];

export interface SsrfValidationResult {
  allowed: boolean;
  sanitizedUrl?: string;
  host?: string;
  reason?: string;
}

export function validateConnectorUrlAgainstSsrf(
  rawUrl: string,
  isUniversalMcpOrHomeAssistant: boolean = false
): SsrfValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { allowed: false, reason: 'URL must be a non-empty string.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { allowed: false, reason: 'Malformed URL format.' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { allowed: false, reason: `Protocol '${parsed.protocol}' is forbidden; only http/https allowed.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Hard-block localhost and private loopbacks
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata.google.internal' ||
    BLOCKED_IP_PREFIXES.some((prefix) => hostname.startsWith(prefix))
  ) {
    return {
      allowed: false,
      reason: `Blocked target host '${hostname}': access to local loopback and internal cloud metadata is strictly forbidden for SSRF safety.`,
    };
  }

  // Allow allowlisted hosts or public web pages / feeds
  if (ALLOWLISTED_CONNECTOR_HOSTS.has(hostname)) {
    return { allowed: true, sanitizedUrl: parsed.toString(), host: hostname };
  }

  // Universal MCP or Home Assistant or public Web pages / RSS feeds
  if (isUniversalMcpOrHomeAssistant || parsed.protocol === 'https:') {
    return { allowed: true, sanitizedUrl: parsed.toString(), host: hostname };
  }

  return {
    allowed: false,
    reason: `Host '${hostname}' is not in the verified connector allowlist.`,
  };
}

// ============================================================================
// 3. RECORDED TEST FIXTURES FOR CONNECTORS (Deterministic & Honest)
// ============================================================================

export const RECORDED_CONNECTOR_TEST_FIXTURES: Record<
  string,
  {
    ok: boolean;
    statusSummary: string;
    sampleData: Record<string, unknown>;
  }
> = {
  'conn-weather': {
    ok: true,
    statusSummary: 'Open-Meteo returned Kyoto current weather: 18.4°C, wind 7.2 km/h, clear sky.',
    sampleData: { temperatureC: 18.4, windSpeedKmH: 7.2, condition: 'Clear', location: 'Kyoto, Japan' },
  },
  'conn-web-fetch': {
    ok: true,
    statusSummary: 'Web page fetcher verified: successfully parsed HTML title and extracted clean body text.',
    sampleData: { title: 'Verified Web Page', contentLengthBytes: 4210, extractedWords: 340 },
  },
  'conn-rss-atom': {
    ok: true,
    statusSummary: 'Feed parser verified: extracted 5 recent articles with valid pubDate timestamps.',
    sampleData: { feedTitle: 'Tech News Digest', itemsCount: 5, latestItem: 'New Open Models Announced' },
  },
  'conn-calendar-ics': {
    ok: true,
    statusSummary: 'ICS parser verified: read-only calendar feed loaded 3 upcoming VEVENT entries.',
    sampleData: { calendarName: 'Personal Schedule', eventsFound: 3, nextEvent: 'Team Standup at 9:00 AM' },
  },
  'conn-wikipedia': {
    ok: true,
    statusSummary: 'Wikipedia REST API verified: fetched summary for "Kyoto" with 1 primary citation.',
    sampleData: { title: 'Kyoto', extract: 'Kyoto is the capital city of Kyoto Prefecture in Japan.', pageId: 16927 },
  },
  'conn-local-folder': {
    ok: true,
    statusSummary: 'Local folder access verified: sandboxed directory handles list 4 documents safely.',
    sampleData: { folderName: 'My Documents', filesCount: 4, readOnly: true },
  },
  'conn-web-search': {
    ok: true,
    statusSummary: 'Search grounded: retrieved 4 verified web results with citation URLs.',
    sampleData: { query: 'Autumn foliage Kyoto', resultsCount: 4, grounded: true },
  },
  'conn-github': {
    ok: true,
    statusSummary: 'GitHub API verified: authenticated as operator; read 2 repositories and rate limits healthy.',
    sampleData: { user: 'operator', rateLimitRemaining: 4980, publicRepos: 2 },
  },
  'conn-telegram': {
    ok: true,
    statusSummary: 'Telegram Bot API verified: getMe returned valid bot handle @MorrowBlaizeBot.',
    sampleData: { botId: 8941029, username: 'MorrowBlaizeBot', canJoinGroups: false },
  },
  'conn-slack': {
    ok: true,
    statusSummary: 'Slack Bot API verified: auth.test succeeded for team "Blaize Workspace" on #general.',
    sampleData: { team: 'Blaize Workspace', botUser: 'U0192834', channel: '#general' },
  },
  'conn-discord': {
    ok: true,
    statusSummary: 'Discord Webhook verified: webhook endpoint reachable and token signature valid.',
    sampleData: { channelId: '1098239082309', guildName: 'Community Server', type: 'incoming_webhook' },
  },
  'conn-notion': {
    ok: true,
    statusSummary: 'Notion API verified: token verified against workspace "Productivity Hub".',
    sampleData: { workspaceName: 'Productivity Hub', botOwner: 'operator@blaize.local' },
  },
  'conn-linear': {
    ok: true,
    statusSummary: 'Linear GraphQL API verified: viewer query returned active team "Core Engineering".',
    sampleData: { teamName: 'Core Engineering', activeIssuesCount: 14 },
  },
  'conn-todoist': {
    ok: true,
    statusSummary: 'Todoist REST API v2 verified: read 6 active tasks from Inbox.',
    sampleData: { tasksCount: 6, primaryProject: 'Inbox' },
  },
  'conn-home-assistant': {
    ok: true,
    statusSummary: 'Home Assistant REST API verified: instance reachable; states for 8 entities loaded.',
    sampleData: { entityCount: 8, locationName: 'Home', version: '2026.10' },
  },
  'conn-google-workspace': {
    ok: true,
    statusSummary: 'Google OAuth token verified: read access confirmed for Drive files and Calendar.',
    sampleData: { userEmail: 'operator@gmail.com', driveFilesFound: 12, calendarEvents: 4 },
  },
  'conn-microsoft-365': {
    ok: true,
    statusSummary: 'Microsoft Graph token verified: read access confirmed for OneDrive and Outlook Calendar.',
    sampleData: { userPrincipalName: 'operator@outlook.com', oneDriveItems: 9, mailFolders: 3 },
  },
  'conn-universal-mcp': {
    ok: true,
    statusSummary: 'MCP Server verified: discovered 3 tools (fs.read, system.info, query.db) via SSE endpoint.',
    sampleData: { serverName: 'Local Dev MCP Server', toolsDiscovered: ['fs.read', 'system.info', 'query.db'] },
  },
};

// ============================================================================
// 4. BUILT-IN INITIAL CONNECTOR MANIFESTS (All 18 connectors)
// ============================================================================

const RAW_INITIAL_CONNECTOR_MANIFESTS: ConnectorManifest[] = [
  // 1. Weather (Open-Meteo) — No account
  {
    id: 'conn-weather',
    name: 'Weather (Open-Meteo)',
    icon: 'cloud-sun',
    category: 'no_account',
    authType: 'none',
    status: 'needs_setup',
    setupGuide: [
      'No account or API key is required — Open-Meteo is open and free for non-commercial use.',
      'Provide your default city or latitude/longitude coordinates (defaults to Kyoto).',
      'Click "Test Connection" to perform an honest live weather query.',
    ],
    scopes: ['weather:read_current', 'weather:read_forecast'],
    tools: [
      { name: 'weather.get_current', description: 'Get live temperature, wind speed and weather code.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'weather.get_forecast', description: 'Get 7-day daily temperature and precipitation forecast.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
    ],
    rateLimits: { requestsPerMinute: 60 },
    healthCheck: { endpoint: 'https://api.open-meteo.com/v1/forecast?latitude=35.0116&longitude=135.7681&current_weather=true', description: 'Fetches Kyoto live weather' },
    writeRequiresApproval: false,
    boundProjectIds: ['proj-autumn-trip-kyoto'],
    credentialsConfigured: true,
  },

  // 2. Web pages (Fetch and read) — No account
  {
    id: 'conn-web-fetch',
    name: 'Web Pages (Fetch & Read)',
    icon: 'globe',
    category: 'no_account',
    authType: 'none',
    status: 'needs_setup',
    setupGuide: [
      'No account needed. Fetches public HTTPS web pages safely through server-side SSRF proxy.',
      'Private IP ranges, localhost, and cloud metadata endpoints are strictly blocked.',
      'Click "Test Connection" to fetch and verify page parsing on a reference site.',
    ],
    scopes: ['web:fetch_html', 'web:extract_text'],
    tools: [
      { name: 'web.fetch_page', description: 'Fetch a public web page and return sanitized markdown or clean text.', risk: 'read', rateLimit: { requestsPerMinute: 30 } },
      { name: 'web.check_link', description: 'Verify if a URL is reachable and returns HTTP 200.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
    ],
    rateLimits: { requestsPerMinute: 30 },
    healthCheck: { endpoint: 'https://api.github.com', description: 'Fetches public reference site to verify proxy' },
    writeRequiresApproval: false,
    boundProjectIds: ['proj-autumn-trip-kyoto', 'proj-book-club'],
    credentialsConfigured: true,
  },

  // 3. RSS and Atom feeds — No account
  {
    id: 'conn-rss-atom',
    name: 'RSS & Atom Feeds',
    icon: 'rss',
    category: 'no_account',
    authType: 'none',
    status: 'needs_setup',
    setupGuide: [
      'No account needed. Reads XML/Atom syndicated news feeds and blogs.',
      'Paste any public RSS or Atom feed URL (e.g. news, tech blogs, podcasts).',
      'Click "Test Connection" to verify XML parsing and item extraction.',
    ],
    scopes: ['feed:read_items'],
    tools: [
      { name: 'rss.read_feed', description: 'Read latest items from an RSS or Atom feed with title and link.', risk: 'read', rateLimit: { requestsPerMinute: 30 } },
    ],
    rateLimits: { requestsPerMinute: 30 },
    healthCheck: { endpoint: 'https://en.wikipedia.org/w/api.php?action=featuredfeed&feed=featured&feedformat=atom', description: 'Wikipedia featured feed' },
    writeRequiresApproval: false,
    boundProjectIds: ['proj-book-club'],
    credentialsConfigured: true,
  },

  // 4. Calendar from ICS link — No account
  {
    id: 'conn-calendar-ics',
    name: 'Calendar from ICS Link (Read-Only)',
    icon: 'calendar',
    category: 'no_account',
    authType: 'none',
    status: 'needs_setup',
    setupGuide: [
      'No account needed. Reads public or private webcal / .ics calendar links.',
      'Paste your iCalendar feed URL from Apple Calendar, Google Calendar, or Outlook.',
      'Click "Test Connection" to parse VEVENT entries without writing any data.',
    ],
    scopes: ['calendar:read_ics'],
    tools: [
      { name: 'calendar.parse_ics', description: 'Parse events from an ICS web feed and list upcoming dates.', risk: 'read', rateLimit: { requestsPerMinute: 30 } },
    ],
    rateLimits: { requestsPerMinute: 30 },
    healthCheck: { endpoint: 'https://raw.githubusercontent.com/icalendar/sample.ics', description: 'Parses sample iCalendar payload' },
    writeRequiresApproval: false,
    boundProjectIds: ['proj-autumn-trip-kyoto'],
    credentialsConfigured: true,
  },

  // 5. Wikipedia — No account
  {
    id: 'conn-wikipedia',
    name: 'Wikipedia Knowledge',
    icon: 'book-open',
    category: 'no_account',
    authType: 'none',
    status: 'needs_setup',
    setupGuide: [
      'No account needed. Uses the free public Wikipedia REST API for verified factual overviews.',
      'Supports searching titles, reading page summaries, and extracting primary citations.',
      'Click "Test Connection" to verify the connection.',
    ],
    scopes: ['wikipedia:search', 'wikipedia:read_summary'],
    tools: [
      { name: 'wikipedia.search', description: 'Search articles by keywords and return top matching titles.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'wikipedia.get_summary', description: 'Get verified plain-language summary and lead paragraph.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
    ],
    rateLimits: { requestsPerMinute: 60 },
    healthCheck: { endpoint: 'https://en.wikipedia.org/api/rest_v1/page/summary/Kyoto', description: 'Fetches Kyoto summary' },
    writeRequiresApproval: false,
    boundProjectIds: ['proj-autumn-trip-kyoto', 'proj-book-club'],
    credentialsConfigured: true,
  },

  // 6. Local folder (File System Access API) — No account
  {
    id: 'conn-local-folder',
    name: 'Local Folder (Sandboxed)',
    icon: 'folder',
    category: 'no_account',
    authType: 'none',
    status: 'needs_setup',
    setupGuide: [
      'No account needed. Uses browser File System Access API with explicit user picker.',
      'Choose a local folder on your computer (e.g. Downloads, Notes, Project folder).',
      'Click "Test Connection" to verify folder reading permissions.',
    ],
    scopes: ['fs:read_directory', 'fs:read_file'],
    tools: [
      { name: 'local_folder.list_files', description: 'List files and sizes in the user-selected folder.', risk: 'read', rateLimit: { requestsPerMinute: 120 } },
      { name: 'local_folder.read_file', description: 'Read text or markdown content from a selected file.', risk: 'read', rateLimit: { requestsPerMinute: 120 } },
    ],
    rateLimits: { requestsPerMinute: 120 },
    healthCheck: { endpoint: 'local://fs-access-api', description: 'Verifies directory handle sandbox' },
    writeRequiresApproval: true,
    boundProjectIds: ['proj-home-garden'],
    credentialsConfigured: true,
  },

  // 7. Web search — No account / Key optional
  {
    id: 'conn-web-search',
    name: 'Web Search',
    icon: 'search',
    category: 'no_account',
    authType: 'none',
    status: 'needs_setup',
    setupGuide: [
      'In Live mode, uses Meta Search Grounding. In Mock mode, uses instant public answers.',
      'Optionally provide a custom search provider API key (SerpAPI, Tavily) in SecretVault.',
      'Click "Test Connection" to run a test search query.',
    ],
    scopes: ['search:query'],
    tools: [
      { name: 'search.query', description: 'Search the web and return verified citations and snippet results.', risk: 'read', rateLimit: { requestsPerMinute: 30 } },
    ],
    rateLimits: { requestsPerMinute: 30 },
    healthCheck: { endpoint: 'https://en.wikipedia.org/w/api.php?action=opensearch&search=Kyoto', description: 'Verifies search index query' },
    writeRequiresApproval: false,
    boundProjectIds: ['proj-autumn-trip-kyoto', 'proj-book-club'],
    credentialsConfigured: true,
  },

  // 8. GitHub — Token
  {
    id: 'conn-github',
    name: 'GitHub',
    icon: 'git-branch',
    category: 'token_or_key',
    authType: 'bearer',
    status: 'needs_setup',
    setupGuide: [
      'Create a fine-grained Personal Access Token at github.com/settings/tokens.',
      'Grant "Repository permissions: Issues (read/write)" or "Contents (read)".',
      'Paste token into the Key Vault and click "Test Connection".',
    ],
    scopes: ['repo:read', 'issues:read', 'issues:write'],
    tools: [
      { name: 'github.list_repos', description: 'List public and private repositories accessible by token.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'github.list_issues', description: 'List open issues on a repository.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'github.create_issue', description: 'Draft a new issue on a repository (requires approval).', risk: 'write', rateLimit: { requestsPerMinute: 20 } },
    ],
    rateLimits: { requestsPerMinute: 60 },
    healthCheck: { endpoint: 'https://api.github.com/user', description: 'Verifies token identity' },
    writeRequiresApproval: true,
    boundProjectIds: [],
    credentialsConfigured: false,
  },

  // 9. Telegram Bot — Token
  {
    id: 'conn-telegram',
    name: 'Telegram Bot',
    icon: 'send',
    category: 'token_or_key',
    authType: 'api_key',
    status: 'needs_setup',
    setupGuide: [
      'Chat with @BotFather on Telegram to create a new bot and copy your Bot API Token.',
      'Paste the token into the Key Vault under key ID "telegram-bot-token".',
      'Click "Test Connection" to call getMe and verify the bot handle.',
    ],
    scopes: ['telegram:read_bot', 'telegram:send_message'],
    tools: [
      { name: 'telegram.get_me', description: 'Get bot username, id, and status.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'telegram.send_message', description: 'Send a notification message to your chat ID (requires approval).', risk: 'write', rateLimit: { requestsPerMinute: 30 } },
    ],
    rateLimits: { requestsPerMinute: 60 },
    healthCheck: { endpoint: 'https://api.telegram.org/bot<TOKEN>/getMe', description: 'Verifies bot handle' },
    writeRequiresApproval: true,
    boundProjectIds: [],
    credentialsConfigured: false,
  },

  // 10. Slack — Bot Token
  {
    id: 'conn-slack',
    name: 'Slack',
    icon: 'slack',
    category: 'token_or_key',
    authType: 'bearer',
    status: 'needs_setup',
    setupGuide: [
      'Create a Slack App at api.slack.com/apps with scopes "channels:read" and "chat:write".',
      'Install the App to your workspace and copy the "Bot User OAuth Token" (xoxb-...).',
      'Store token in the Key Vault and click "Test Connection".',
    ],
    scopes: ['channels:read', 'chat:write'],
    tools: [
      { name: 'slack.list_channels', description: 'List public channels in the Slack workspace.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'slack.post_message', description: 'Post a notification message to a channel (requires approval).', risk: 'write', rateLimit: { requestsPerMinute: 20 } },
    ],
    rateLimits: { requestsPerMinute: 60 },
    healthCheck: { endpoint: 'https://slack.com/api/auth.test', description: 'Verifies team connection' },
    writeRequiresApproval: true,
    boundProjectIds: [],
    credentialsConfigured: false,
  },

  // 11. Discord — Webhook
  {
    id: 'conn-discord',
    name: 'Discord Webhook',
    icon: 'message-square',
    category: 'token_or_key',
    authType: 'bearer',
    status: 'needs_setup',
    setupGuide: [
      'In Discord channel settings, go to Integrations > Webhooks > "New Webhook".',
      'Copy the Webhook URL (https://discord.com/api/webhooks/...).',
      'Paste URL into the Key Vault and click "Test Connection".',
    ],
    scopes: ['discord:send_webhook'],
    tools: [
      { name: 'discord.send_webhook', description: 'Send a formatted message or scheduled report to Discord (requires approval).', risk: 'write', rateLimit: { requestsPerMinute: 30 } },
    ],
    rateLimits: { requestsPerMinute: 30 },
    healthCheck: { endpoint: 'https://discord.com/api/webhooks', description: 'Verifies webhook format and reachability' },
    writeRequiresApproval: true,
    boundProjectIds: [],
    credentialsConfigured: false,
  },

  // 12. Notion — API Key
  {
    id: 'conn-notion',
    name: 'Notion',
    icon: 'file-text',
    category: 'token_or_key',
    authType: 'bearer',
    status: 'needs_setup',
    setupGuide: [
      'Go to notion.so/my-integrations and create a new Internal Integration Token.',
      'Share target Notion pages or databases with your integration in page settings.',
      'Paste the token into Key Vault and click "Test Connection".',
    ],
    scopes: ['notion:read_pages', 'notion:write_pages'],
    tools: [
      { name: 'notion.search_pages', description: 'Search pages and database titles in Notion.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'notion.create_page', description: 'Create a new page in a shared Notion parent (requires approval).', risk: 'write', rateLimit: { requestsPerMinute: 20 } },
    ],
    rateLimits: { requestsPerMinute: 60 },
    healthCheck: { endpoint: 'https://api.notion.com/v1/users/me', description: 'Verifies Notion bot identity' },
    writeRequiresApproval: true,
    boundProjectIds: [],
    credentialsConfigured: false,
  },

  // 13. Linear — API Key
  {
    id: 'conn-linear',
    name: 'Linear',
    icon: 'check-square',
    category: 'token_or_key',
    authType: 'api_key',
    status: 'needs_setup',
    setupGuide: [
      'In Linear, go to Settings > Account > API and generate a Personal API Key.',
      'Copy the key starting with "lin_api_...".',
      'Paste into the Key Vault and click "Test Connection".',
    ],
    scopes: ['linear:read_issues', 'linear:create_issues'],
    tools: [
      { name: 'linear.list_issues', description: 'List assigned and open issues from your Linear team.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'linear.create_issue', description: 'Create a new issue draft in Linear (requires approval).', risk: 'write', rateLimit: { requestsPerMinute: 20 } },
    ],
    rateLimits: { requestsPerMinute: 60 },
    healthCheck: { endpoint: 'https://api.linear.app/graphql', description: 'GraphQL viewer query' },
    writeRequiresApproval: true,
    boundProjectIds: [],
    credentialsConfigured: false,
  },

  // 14. Todoist — API Token
  {
    id: 'conn-todoist',
    name: 'Todoist',
    icon: 'check-circle',
    category: 'token_or_key',
    authType: 'bearer',
    status: 'needs_setup',
    setupGuide: [
      'In Todoist, go to Settings > Integrations > Developer and copy your API Token.',
      'Store token safely in Key Vault under key ID "todoist-token".',
      'Click "Test Connection" to verify reading tasks.',
    ],
    scopes: ['todoist:read_tasks', 'todoist:write_tasks'],
    tools: [
      { name: 'todoist.get_tasks', description: 'List today tasks and inbox items.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'todoist.create_task', description: 'Add a new task with due date (requires approval).', risk: 'write', rateLimit: { requestsPerMinute: 30 } },
    ],
    rateLimits: { requestsPerMinute: 60 },
    healthCheck: { endpoint: 'https://api.todoist.com/rest/v2/tasks', description: 'Fetches active task count' },
    writeRequiresApproval: true,
    boundProjectIds: [],
    credentialsConfigured: false,
  },

  // 15. Home Assistant — URL & Token
  {
    id: 'conn-home-assistant',
    name: 'Home Assistant',
    icon: 'home',
    category: 'token_or_key',
    authType: 'bearer',
    status: 'needs_setup',
    setupGuide: [
      'In Home Assistant, go to Profile > Long-Lived Access Tokens and create a token.',
      'Provide your Home Assistant URL (e.g. https://homeassistant.local:8123 or public HTTPS).',
      'Store URL & token in Key Vault and click "Test Connection".',
    ],
    scopes: ['hass:read_states', 'hass:call_services'],
    tools: [
      { name: 'homeassistant.get_states', description: 'Read sensor states, temperatures, and light switches.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'homeassistant.call_service', description: 'Toggle a switch or run a scene (requires approval).', risk: 'write', rateLimit: { requestsPerMinute: 30 } },
    ],
    rateLimits: { requestsPerMinute: 60 },
    healthCheck: { endpoint: 'https://homeassistant.local:8123/api/', description: 'Verifies API running message' },
    writeRequiresApproval: true,
    boundProjectIds: ['proj-home-garden'],
    credentialsConfigured: false,
  },

  // 16. Google Workspace — OAuth PKCE
  {
    id: 'conn-google-workspace',
    name: 'Google (Drive, Docs, Calendar, Gmail)',
    icon: 'layers',
    category: 'oauth_pkce',
    authType: 'oauth_pkce',
    status: 'needs_setup',
    setupGuide: [
      'Honest note: Requires a Google Cloud Project with OAuth Client ID (or developer app setup).',
      'Enable Google Drive, Google Docs, Google Calendar, and Gmail (read-only) APIs.',
      'Configure authorized redirect URI in Google Console, enter your Client ID, and sign in via PKCE.',
    ],
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
    tools: [
      { name: 'google.list_drive_files', description: 'List recent files in Google Drive.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'google.read_calendar', description: 'Read upcoming events from Google Calendar.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'google.read_gmail_threads', description: 'Read email subjects and senders from inbox (read-only).', risk: 'read', rateLimit: { requestsPerMinute: 30 } },
    ],
    rateLimits: { requestsPerMinute: 60 },
    healthCheck: { endpoint: 'https://www.googleapis.com/oauth2/v3/userinfo', description: 'OAuth token introspection' },
    writeRequiresApproval: true,
    boundProjectIds: ['proj-autumn-trip-kyoto'],
    credentialsConfigured: false,
  },

  // 17. Microsoft 365 — OAuth PKCE
  {
    id: 'conn-microsoft-365',
    name: 'Microsoft 365 (OneDrive, Outlook, Calendar)',
    icon: 'layers',
    category: 'oauth_pkce',
    authType: 'oauth_pkce',
    status: 'needs_setup',
    setupGuide: [
      'Honest note: Requires an Azure App Registration with OAuth Client ID (or personal MS app).',
      'Add Microsoft Graph delegated permissions: Files.Read, Calendars.Read, Mail.Read.',
      'Enter your Client ID, authorize via PKCE redirect, and click "Test Connection".',
    ],
    scopes: ['Files.Read', 'Calendars.Read', 'Mail.Read'],
    tools: [
      { name: 'm365.list_drive_files', description: 'List files in OneDrive.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'm365.get_calendar_events', description: 'Get upcoming Outlook calendar events.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'm365.read_mail', description: 'Read recent Outlook inbox email subjects (read-only).', risk: 'read', rateLimit: { requestsPerMinute: 30 } },
    ],
    rateLimits: { requestsPerMinute: 60 },
    healthCheck: { endpoint: 'https://graph.microsoft.com/v1.0/me', description: 'Graph user identity query' },
    writeRequiresApproval: true,
    boundProjectIds: [],
    credentialsConfigured: false,
  },

  // 18. Universal MCP Connector
  {
    id: 'conn-universal-mcp',
    name: 'Universal MCP Connector',
    icon: 'network',
    category: 'universal_mcp',
    authType: 'mcp',
    status: 'needs_setup',
    setupGuide: [
      'Provide your MCP Server URL (HTTP/SSE or WebSocket endpoint).',
      'Provide optional bearer token or header credentials in SecretVault.',
      'Click "Test Connection" to discover tools via MCP protocol and enable them per project.',
    ],
    scopes: ['mcp:discover_tools', 'mcp:call_tool'],
    tools: [
      { name: 'mcp.discover_tools', description: 'Query MCP server to discover capabilities and tool schemas.', risk: 'read', rateLimit: { requestsPerMinute: 60 } },
      { name: 'mcp.call_tool', description: 'Call a discovered MCP tool (write tools require explicit approval).', risk: 'write', rateLimit: { requestsPerMinute: 60 } },
    ],
    rateLimits: { requestsPerMinute: 60 },
    healthCheck: { endpoint: 'http://localhost:8080/sse', description: 'MCP server tool discovery endpoint' },
    writeRequiresApproval: true,
    boundProjectIds: [],
    credentialsConfigured: false,
  },
];

export const INITIAL_CONNECTOR_MANIFESTS: ConnectorManifest[] = RAW_INITIAL_CONNECTOR_MANIFESTS.map((manifest): ConnectorManifest => {
  const adapter = CONNECTOR_PROVIDER_ADAPTERS[manifest.id];
  const implemented = Boolean(adapter?.adapterImplemented);
  return {
    ...manifest,
    adapterImplemented: implemented,
    status: implemented ? 'needs_setup' : 'not_configured',
    evidenceClass: implemented ? 'NEEDS_SETUP' : 'NOT_CONFIGURED',
  };
});

// ============================================================================
// 5. CONNECTOR TESTING & EXECUTION ENGINE (Honest Status Rule)
// ============================================================================

export interface ConnectorTestOptions {
  connector: ConnectorManifest;
  mode?: 'mock' | 'live';
  customToken?: string;
  transport?: ConnectorHttpTransport;
  workspaceRoot?: string;
}

export async function testConnectorReal(
  options: ConnectorTestOptions
): Promise<{
  ok: boolean;
  status: ConnectorStatus;
  evidenceClass: ConnectorEvidenceClass;
  isSimulated: boolean;
  connectionTestProvesAllToolsWork: false;
  summary: string;
  testedAt: string;
  sampleData?: Record<string, unknown>;
  error?: string;
}> {
  const { connector, mode = 'mock', customToken, transport, workspaceRoot } = options;
  const now = new Date();
  const testedAt = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const adapter = getConnectorProviderAdapter(connector.id);
  const isAdapterImplemented =
    connector.adapterImplemented !== undefined
      ? connector.adapterImplemented
      : Boolean(adapter?.adapterImplemented);

  // 1. Missing credentials -> NEEDS_SETUP
  if (
    connector.authType !== 'none' &&
    !connector.credentialsConfigured &&
    !customToken
  ) {
    return {
      ok: false,
      status: 'needs_setup',
      evidenceClass: 'NEEDS_SETUP',
      isSimulated: false,
      connectionTestProvesAllToolsWork: false,
      summary: `Needs setup: ${connector.name} requires credentials. See the 3-step setup guide.`,
      testedAt,
      error: 'Missing credentials. Configure in Key Vault first.',
    };
  }

  // 2. Fixture / Mock mode -> Strictly labelled SIMULATED (NEVER 'connected'!)
  if (mode === 'mock') {
    const fixture = RECORDED_CONNECTOR_TEST_FIXTURES[connector.id];
    if (fixture) {
      return {
        ok: fixture.ok,
        status: fixture.ok ? 'simulated' : 'error',
        evidenceClass: fixture.ok ? 'SIMULATED' : 'FAILED',
        isSimulated: true,
        connectionTestProvesAllToolsWork: false,
        summary: `[SIMULATED FIXTURE] ${fixture.statusSummary}`,
        testedAt,
        sampleData: fixture.sampleData,
      };
    }
    return {
      ok: false,
      status: 'not_configured',
      evidenceClass: 'NOT_CONFIGURED',
      isSimulated: false,
      connectionTestProvesAllToolsWork: false,
      summary: `No recorded fixture or live adapter configured for ${connector.name}.`,
      testedAt,
      error: 'Connector is not configured.',
    };
  }

  // 3. Live Mode: Catalogue-only entries without a real provider adapter -> NOT_CONFIGURED
  if (!isAdapterImplemented || !adapter) {
    return {
      ok: false,
      status: 'not_configured',
      evidenceClass: 'NOT_CONFIGURED',
      isSimulated: false,
      connectionTestProvesAllToolsWork: false,
      summary: `Not configured: ${connector.name} is a catalogue entry without a live provider adapter in this build.`,
      testedAt,
      error: `Provider adapter for '${connector.id}' is not configured.`,
    };
  }

  // 4. Live Mode with Real Provider Adapter:
  // If customToken is passed for a bearer/oauth connector, execute healthCheck via transport/fetch
  if (connector.authType !== 'none' && customToken) {
    const ssrf = validateConnectorUrlAgainstSsrf(
      connector.customEndpointUrl || connector.healthCheck.endpoint,
      connector.id === 'conn-universal-mcp' || connector.id === 'conn-home-assistant'
    );
    if (!ssrf.allowed || !ssrf.sanitizedUrl) {
      return {
        ok: false,
        status: 'error',
        evidenceClass: 'FAILED',
        isSimulated: false,
        connectionTestProvesAllToolsWork: false,
        summary: `SSRF guard blocked health check URL: ${ssrf.reason}`,
        testedAt,
        error: ssrf.reason,
      };
    }
    try {
      const doFetch = transport
        ? await transport({
            url: ssrf.sanitizedUrl,
            method: connector.healthCheck.method || 'GET',
            headers: {
              Authorization: `Bearer ${customToken}`,
              Accept: 'application/json',
            },
          })
        : await (async () => {
            const r = await fetch(ssrf.sanitizedUrl!, {
              method: connector.healthCheck.method || 'GET',
              headers: {
                Authorization: `Bearer ${customToken}`,
                Accept: 'application/json',
              },
            });
            const text = await r.text();
            let json: unknown;
            try {
              json = JSON.parse(text);
            } catch {
              // ignore
            }
            return { ok: r.ok, status: r.status, headers: {}, text, json };
          })();

      if (!doFetch.ok || !doFetch.json || typeof doFetch.json !== 'object') {
        return {
          ok: false,
          status: 'error',
          evidenceClass: 'FAILED',
          isSimulated: false,
          connectionTestProvesAllToolsWork: false,
          summary: `${connector.name} live authentication test failed (HTTP ${doFetch.status}).`,
          testedAt,
          error: `Upstream returned HTTP ${doFetch.status}.`,
        };
      }

      return {
        ok: true,
        status: 'connected',
        evidenceClass: 'REAL',
        isSimulated: false,
        connectionTestProvesAllToolsWork: false,
        summary: `${connector.name} live provider authentication verified (HTTP ${doFetch.status}).`,
        testedAt,
        sampleData: doFetch.json as Record<string, unknown>,
      };
    } catch (err) {
      return {
        ok: false,
        status: 'error',
        evidenceClass: 'FAILED',
        isSimulated: false,
        connectionTestProvesAllToolsWork: false,
        summary: `${connector.name} live connection failed: ${err instanceof Error ? err.message : String(err)}`,
        testedAt,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Delegate to the real provider adapter's testConnection
  const adapterRes = await adapter.testConnection({
    mode: 'live',
    customEndpointUrl: connector.customEndpointUrl || connector.healthCheck.endpoint,
    workspaceRoot,
    transport,
  });

  return {
    ok: adapterRes.ok,
    status: adapterRes.status,
    evidenceClass: adapterRes.evidenceClass,
    isSimulated: adapterRes.isSimulated,
    connectionTestProvesAllToolsWork: false,
    summary: adapterRes.summary,
    testedAt,
    error: adapterRes.error?.message,
  };
}

/**
 * Invoke a connector tool through PolicyGuard check, capability check & Rule Book rules.
 * Never claims REAL execution unless a real provider response is supplied or executed via invokeConnectorAdapterTool.
 */
export function invokeConnectorToolWithSafety(input: {
  connector: ConnectorManifest;
  toolName: string;
  params: Record<string, unknown>;
  rules: ScopedRuleItem[];
  operatorApproved?: boolean;
  approvalToken?: ScopedApprovalToken;
  grantedCapabilities?: string[];
  grantedScopes?: string[];
  mode?: 'mock' | 'live';
  verifiedProviderData?: Record<string, unknown>;
}): ConnectorInvocationResult {
  const {
    connector,
    toolName,
    rules,
    operatorApproved = false,
    approvalToken,
    grantedCapabilities,
    mode = 'mock',
    verifiedProviderData,
  } = input;
  const tool = connector.tools.find((t) => t.name === toolName);

  if (!tool) {
    return {
      ok: false,
      toolName,
      risk: 'read',
      status: 'failed',
      evidenceClass: 'UNSUPPORTED',
      isSimulated: false,
      error: `Tool "${toolName}" not found on connector "${connector.name}".`,
      recordedInLedger: false,
    };
  }

  // Check if adapter is implemented when in live mode
  const adapter = getConnectorProviderAdapter(connector.id);
  const isImplemented =
    connector.adapterImplemented !== undefined
      ? connector.adapterImplemented
      : Boolean(adapter?.adapterImplemented);

  if (mode === 'live' && !isImplemented) {
    return {
      ok: false,
      toolName,
      risk: tool.risk,
      status: 'not_configured',
      evidenceClass: 'NOT_CONFIGURED',
      isSimulated: false,
      error: `Connector "${connector.name}" is not configured with a live provider adapter.`,
      recordedInLedger: false,
    };
  }

  // Exact capability grant check if caller supplied grantedCapabilities
  if (grantedCapabilities) {
    const exactCap = `connector:${connector.id}:${toolName}`;
    const wildcardCap = `connector:${connector.id}:*`;
    if (
      !grantedCapabilities.includes(exactCap) &&
      !grantedCapabilities.includes(wildcardCap)
    ) {
      return {
        ok: false,
        toolName,
        risk: tool.risk,
        status: 'blocked_by_rule',
        evidenceClass: 'BLOCKED',
        isSimulated: false,
        error: `Missing capability grant "${exactCap}" for connector "${connector.name}".`,
        recordedInLedger: true,
        ledgerRef: `lead-cap-deny-${Date.now()}`,
      };
    }
  }

  // 1. Rule Book block overrides everything
  const matchedRule = rules.find(
    (r) =>
      r.enabled &&
      (r.scope === 'Everywhere' ||
        (r.scope === 'Connector' &&
          (!r.targetName || r.targetName.toLowerCase().includes(connector.name.toLowerCase())))) &&
      (r.actionClass === 'write' || r.actionClass === 'destructive')
  );

  if (matchedRule?.enforcement === 'block' && tool.risk === 'write') {
    return {
      ok: false,
      toolName,
      risk: tool.risk,
      status: 'blocked_by_rule',
      evidenceClass: 'BLOCKED',
      isSimulated: false,
      error: `Blocked for safety: Rule Book prohibits write action "${toolName}" on connector "${connector.name}".`,
      recordedInLedger: true,
    };
  }

  // 2. Prepare single-use approval token if operator approval was granted
  let activeToken = approvalToken;
  if (!activeToken && operatorApproved && tool.risk === 'write') {
    activeToken = globalApprovalTokenStore.issueToken({
      toolOrActionName: `connector.${toolName}`,
      target: connector.name,
      payload: input.params,
      profileId: 'personal',
      issuedBy: 'operator',
      scopeReason: `Operator approved write action '${toolName}' on connector '${connector.name}'`,
    });
  }

  // 3. Central PolicyEngine Authorization Boundary
  const policyDecision = globalPolicyEngine.evaluateToolCall({
    callerId: `connector:${connector.id}`,
    toolName: `connector.${toolName}`,
    target: connector.name,
    args: input.params,
    riskClass: tool.risk === 'write' ? 'external_send' : 'read',
    approvalToken: activeToken,
  });

  if (!policyDecision.allowed) {
    const isApproval =
      policyDecision.decision === 'REQUIRE_APPROVAL' ||
      policyDecision.decision === 'SUSPEND_TAKEOVER';
    return {
      ok: false,
      toolName,
      risk: tool.risk,
      status: isApproval ? 'needs_approval' : 'blocked_by_rule',
      evidenceClass: isApproval ? 'WAITING_FOR_APPROVAL' : 'BLOCKED',
      isSimulated: false,
      error: isApproval
        ? `Needs your approval: Write tool "${toolName}" on "${connector.name}" modifies external state.`
        : `Blocked for safety: PolicyGuard denied "${toolName}" on connector "${connector.name}" (${policyDecision.reason}).`,
      recordedInLedger: !isApproval,
    };
  }

  // 4. Write tools need approval per writeRequiresApproval or Rule Book
  if (tool.risk === 'write') {
    const ruleEnforcement =
      matchedRule?.enforcement || (connector.writeRequiresApproval ? 'ask_first' : 'allow');
    if (ruleEnforcement === 'ask_first' && !operatorApproved && !activeToken) {
      return {
        ok: false,
        toolName,
        risk: 'write',
        status: 'needs_approval',
        evidenceClass: 'WAITING_FOR_APPROVAL',
        isSimulated: false,
        error: `Needs your approval: Write tool "${toolName}" on "${connector.name}" modifies external state.`,
        recordedInLedger: false,
      };
    }
  }

  // 5. In live mode without verified provider data, refuse to fabricate generic "executed" output
  if (mode === 'live' && !verifiedProviderData) {
    return {
      ok: false,
      toolName,
      risk: tool.risk,
      status: 'failed',
      evidenceClass: 'FAILED',
      isSimulated: false,
      error: `Live invocation of "${toolName}" requires async provider execution via invokeConnectorAdapterTool.`,
      recordedInLedger: true,
    };
  }

  if (mode === 'live' && verifiedProviderData) {
    return {
      ok: true,
      toolName,
      risk: tool.risk,
      status: 'executed',
      evidenceClass: 'REAL',
      isSimulated: false,
      output: {
        ...verifiedProviderData,
        timestamp: new Date().toISOString(),
        consumedApprovalToken: activeToken?.tokenId,
      },
      recordedInLedger: true,
      ledgerRef: `lead-${Date.now()}`,
    };
  }

  // 6. Mock / preview fixture execution -> explicitly marked SIMULATED
  const fixture = RECORDED_CONNECTOR_TEST_FIXTURES[connector.id];
  return {
    ok: true,
    toolName,
    risk: tool.risk,
    status: 'executed',
    evidenceClass: 'SIMULATED',
    isSimulated: true,
    output: {
      simulated: true,
      evidenceClass: 'SIMULATED',
      sampleData: fixture?.sampleData ?? input.params,
      timestamp: new Date().toISOString(),
      consumedApprovalToken: activeToken?.tokenId,
    },
    recordedInLedger: true,
    ledgerRef: `lead-sim-${Date.now()}`,
  };
}

// ============================================================================
// 6. EVERYDAY SCHEDULER: TYPES, FREQUENCIES & TEMPLATES
// ============================================================================

export type ScheduleFrequency =
  | 'once'
  | 'every_day'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'custom';

export type ScheduleMode = 'remind_only' | 'do_for_me';

export type ScheduleNotificationChannel = 'toast' | 'chat' | 'quiet_log';

export type MissedRunPolicy = 'run_when_back' | 'skip' | 'ask_me';

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface EverydayScheduleItem {
  id: string;
  title: string;
  prompt: string;
  frequency: ScheduleFrequency;
  timeOfDay: string; // "08:00" in 24h
  daysOfWeek?: DayOfWeek[]; // For weekly frequency
  mode: ScheduleMode;
  channel: ScheduleNotificationChannel;
  missedRunPolicy: MissedRunPolicy;
  enabled: boolean;
  nextRunLocal: string; // Plain words: "Tomorrow, 8:00 AM"
  nextRunEpochMs: number;
  lastRunAt?: string;
  lastRunStatus?: 'done' | 'skipped_away' | 'needs_ok' | 'idle';
  advancedCron?: string; // Hidden behind 'Advanced'
  advancedUtcTimestamp?: string; // Hidden behind 'Advanced'
  templateId?: string;
  requiresMoneyOrSensitive: boolean; // Must be false for unattended
}

export interface NeutralScheduleTemplate {
  id: string;
  title: string;
  prompt: string;
  icon: string;
  suggestedFrequency: ScheduleFrequency;
  suggestedTime: string;
  suggestedDays?: DayOfWeek[];
  suggestedMode: ScheduleMode;
}

export const NEUTRAL_SCHEDULE_TEMPLATES: NeutralScheduleTemplate[] = [
  {
    id: 'tpl-morning-briefing',
    title: 'Morning briefing',
    prompt: "Summarize today's agenda, weather forecast, and top news.",
    icon: 'sun',
    suggestedFrequency: 'weekdays',
    suggestedTime: '08:00',
    suggestedMode: 'do_for_me',
  },
  {
    id: 'tpl-daily-plan',
    title: 'Daily plan',
    prompt: 'Review active project goals and build a prioritized to-do list for today.',
    icon: 'calendar-check',
    suggestedFrequency: 'every_day',
    suggestedTime: '08:30',
    suggestedMode: 'do_for_me',
  },
  {
    id: 'tpl-tidy-downloads',
    title: 'Tidy my downloads weekly',
    prompt: 'Check the downloads folder for files older than 30 days and suggest cleanup.',
    icon: 'folder-archive',
    suggestedFrequency: 'weekly',
    suggestedDays: ['fri'],
    suggestedTime: '17:00',
    suggestedMode: 'do_for_me',
  },
  {
    id: 'tpl-weekly-summary',
    title: 'Weekly summary',
    prompt: 'Summarize what we completed this week across projects, files, and chats.',
    icon: 'bar-chart-2',
    suggestedFrequency: 'weekly',
    suggestedDays: ['fri'],
    suggestedTime: '16:00',
    suggestedMode: 'do_for_me',
  },
  {
    id: 'tpl-remind-me',
    title: 'Remind me to...',
    prompt: 'Remind me about an upcoming deadline or event.',
    icon: 'bell',
    suggestedFrequency: 'once',
    suggestedTime: '14:00',
    suggestedMode: 'remind_only',
  },
  {
    id: 'tpl-page-changed',
    title: 'Tell me when a page changes',
    prompt: 'Fetch the target project site every weekday and alert me if content changed.',
    icon: 'refresh-cw',
    suggestedFrequency: 'weekdays',
    suggestedTime: '09:00',
    suggestedMode: 'do_for_me',
  },
  {
    id: 'tpl-backup-folder',
    title: 'Back up a folder',
    prompt: 'Create a timestamped copy of important project artifacts and save to backup.',
    icon: 'shield-check',
    suggestedFrequency: 'weekly',
    suggestedDays: ['sun'],
    suggestedTime: '20:00',
    suggestedMode: 'do_for_me',
  },
];

// ============================================================================
// 7. DEVICE TIMEZONE & DST-AWARE COMPUTATION
// ============================================================================

export function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
  } catch {
    return 'UTC';
  }
}

/**
 * Format a 24h "HH:MM" string into friendly 12h "8:00 AM"
 */
export function formatTime12h(timeOfDay: string): string {
  const [hStr, mStr] = (timeOfDay || '08:00').split(':');
  let h = parseInt(hStr || '8', 10);
  const m = mStr ? mStr.padStart(2, '0') : '00';
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

/**
 * Format plain English frequency description (e.g. 'Every weekday at 8:00 AM')
 */
export function formatFrequencyPlainWords(
  frequency: ScheduleFrequency,
  timeOfDay: string,
  daysOfWeek?: DayOfWeek[]
): string {
  const timeFormatted = formatTime12h(timeOfDay);
  if (frequency === 'once') return `Once at ${timeFormatted}`;
  if (frequency === 'every_day') return `Every day at ${timeFormatted}`;
  if (frequency === 'weekdays') return `Every weekday at ${timeFormatted}`;
  if (frequency === 'monthly') return `Monthly at ${timeFormatted}`;
  if (frequency === 'weekly') {
    const dayLabels = (daysOfWeek || ['mon']).map((d) => {
      const map: Record<DayOfWeek, string> = {
        mon: 'Mon',
        tue: 'Tue',
        wed: 'Wed',
        thu: 'Thu',
        fri: 'Fri',
        sat: 'Sat',
        sun: 'Sun',
      };
      return map[d] || d;
    });
    return `Weekly on ${dayLabels.join(', ')} at ${timeFormatted}`;
  }
  return `Custom at ${timeFormatted}`;
}

/**
 * Compute the next execution Date and plain words using a real 5-field cron expression
 * and IANA timezone (DST-correct).
 */
export function computeNextScheduleRun(input: {
  frequency: ScheduleFrequency;
  timeOfDay: string;
  daysOfWeek?: DayOfWeek[];
  fromTime?: Date;
  timeZone?: string;
  customCronExpression?: string;
  scheduleId?: string;
}): {
  nextEpochMs: number;
  plainWords: string;
  utcIso: string;
  cronExpression: string;
  timeZone: string;
  idempotencyKey: string;
} {
  const now = input.fromTime || new Date();
  const timeZone =
    input.timeZone && isValidIanaTimeZone(input.timeZone)
      ? input.timeZone
      : getDeviceTimeZone();
  const [rawH, rawM] = (input.timeOfDay || '08:00').split(':').map((s) => parseInt(s, 10));
  const targetH = Number.isFinite(rawH) && rawH >= 0 && rawH <= 23 ? rawH : 8;
  const targetM = Number.isFinite(rawM) && rawM >= 0 && rawM <= 59 ? rawM : 0;

  const dayMap: Record<DayOfWeek, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
  };

  let cron = input.customCronExpression?.trim() || '';
  if (!cron) {
    if (input.frequency === 'every_day' || input.frequency === 'once') {
      cron = `${targetM} ${targetH} * * *`;
    } else if (input.frequency === 'weekdays') {
      cron = `${targetM} ${targetH} * * 1-5`;
    } else if (input.frequency === 'weekly') {
      const targetDays =
        input.daysOfWeek && input.daysOfWeek.length > 0
          ? input.daysOfWeek.map((d) => dayMap[d])
          : [1];
      cron = `${targetM} ${targetH} * * ${targetDays.join(',')}`;
    } else if (input.frequency === 'monthly') {
      cron = `${targetM} ${targetH} 1 * *`;
    } else {
      cron = `${targetM} ${targetH} * * *`;
    }
  }

  // Validate 5-field cron expression
  parseCronExpression(cron);

  const [slot] = computeNextRunsInTimeZone({
    cronExpression: cron,
    timeZone,
    fromTime: now,
    count: 1,
    scheduleId: input.scheduleId ?? 'sched',
  });

  if (!slot) {
    throw new Error(`Unable to compute next schedule run for cron '${cron}' in '${timeZone}'.`);
  }

  return {
    nextEpochMs: slot.epochMs,
    plainWords: slot.plainWords,
    utcIso: slot.utcIso,
    cronExpression: cron,
    timeZone: slot.timeZone,
    idempotencyKey: slot.idempotencyKey,
  };
}

// ============================================================================
// 8. SLEEP / WAKE DETECTION & MISSED RUN POLICIES
// ============================================================================

export interface SleepWakeEvaluationResult {
  detectedWakeFromSleep: boolean;
  sleptDurationMinutes: number;
  missedTasks: {
    schedule: EverydayScheduleItem;
    missedRunTime: string;
    actionTaken: 'executed_now' | 'skipped' | 'queued_for_approval';
  }[];
  updatedSchedules: EverydayScheduleItem[];
}

/**
 * Re-evaluate schedules on system wake (e.g. laptop lid opened or browser tab visible again).
 * Requirement 10: Default missed-run policy is 'skip' (with optional 'run_when_back' or 'ask_me').
 */
export function evaluateSleepAndWake(input: {
  lastCheckedEpochMs: number;
  nowEpochMs: number;
  schedules: EverydayScheduleItem[];
  defaultMissedPolicy?: MissedRunPolicy;
  timeZone?: string;
}): SleepWakeEvaluationResult {
  const {
    lastCheckedEpochMs,
    nowEpochMs,
    schedules,
    defaultMissedPolicy = 'skip',
    timeZone,
  } = input;
  const elapsedMs = nowEpochMs - lastCheckedEpochMs;
  const sleptDurationMinutes = Math.round(elapsedMs / (60 * 1000));

  // Consider sleep if gap is greater than 5 minutes
  const detectedWakeFromSleep = elapsedMs > 5 * 60 * 1000;

  const missedTasks: SleepWakeEvaluationResult['missedTasks'] = [];
  const updatedSchedules: EverydayScheduleItem[] = [];

  for (const schedule of schedules) {
    if (!schedule.enabled) {
      updatedSchedules.push(schedule);
      continue;
    }

    // Check if scheduled time fell between last checked and now
    if (schedule.nextRunEpochMs >= lastCheckedEpochMs && schedule.nextRunEpochMs <= nowEpochMs) {
      const policy = schedule.missedRunPolicy || defaultMissedPolicy;
      let actionTaken: 'executed_now' | 'skipped' | 'queued_for_approval' = 'skipped';

      if (policy === 'skip') {
        actionTaken = 'skipped';
      } else if (policy === 'ask_me') {
        actionTaken = 'queued_for_approval';
      } else {
        // 'run_when_back'
        // If it requires money or sensitive, it cannot run unattended!
        if (schedule.requiresMoneyOrSensitive) {
          actionTaken = 'queued_for_approval';
        } else {
          actionTaken = 'executed_now';
        }
      }

      missedTasks.push({
        schedule,
        missedRunTime: new Date(schedule.nextRunEpochMs).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        }),
        actionTaken,
      });

      // Recalculate next run from now in the active IANA timezone
      const nextRun = computeNextScheduleRun({
        frequency: schedule.frequency,
        timeOfDay: schedule.timeOfDay,
        daysOfWeek: schedule.daysOfWeek,
        fromTime: new Date(nowEpochMs),
        timeZone,
        customCronExpression: schedule.advancedCron,
        scheduleId: schedule.id,
      });

      updatedSchedules.push({
        ...schedule,
        lastRunAt: 'Just now (on wake)',
        lastRunStatus:
          actionTaken === 'executed_now'
            ? 'done'
            : actionTaken === 'skipped'
              ? 'skipped_away'
              : 'needs_ok',
        nextRunLocal: nextRun.plainWords,
        nextRunEpochMs: nextRun.nextEpochMs,
        advancedUtcTimestamp: nextRun.utcIso,
      });
    } else {
      updatedSchedules.push(schedule);
    }
  }

  return {
    detectedWakeFromSleep,
    sleptDurationMinutes,
    missedTasks,
    updatedSchedules,
  };
}

// ============================================================================
// 9. NATURAL LANGUAGE SCHEDULER PARSER
// ============================================================================

export interface ParsedScheduleIntent {
  matched: boolean;
  frequency: ScheduleFrequency;
  timeOfDay: string;
  daysOfWeek?: DayOfWeek[];
  extractedTitle?: string;
  confidence: number;
}

export function parseNaturalLanguageSchedule(input: string): ParsedScheduleIntent {
  const lower = (input || '').toLowerCase().trim();

  let frequency: ScheduleFrequency = 'every_day';
  let timeOfDay = '08:00';
  let daysOfWeek: DayOfWeek[] | undefined = undefined;
  let matched = false;

  // 1. Detect Frequency
  if (lower.includes('weekday') || lower.includes('workday') || lower.includes('mon to fri')) {
    frequency = 'weekdays';
    matched = true;
  } else if (lower.includes('every day') || lower.includes('daily') || lower.includes('each day')) {
    frequency = 'every_day';
    matched = true;
  } else if (lower.includes('weekly') || lower.includes('every week')) {
    frequency = 'weekly';
    daysOfWeek = ['mon'];
    matched = true;
  } else if (lower.includes('once') || lower.includes('tomorrow at')) {
    frequency = 'once';
    matched = true;
  }

  // Check specific day names
  const dayPatterns: [DayOfWeek, RegExp][] = [
    ['mon', /\b(monday|mondays)\b/],
    ['tue', /\b(tuesday|tuesdays)\b/],
    ['wed', /\b(wednesday|wednesdays)\b/],
    ['thu', /\b(thursday|thursdays)\b/],
    ['fri', /\b(friday|fridays)\b/],
    ['sat', /\b(saturday|saturdays)\b/],
    ['sun', /\b(sunday|sundays)\b/],
  ];

  const foundDays = dayPatterns.filter(([, re]) => re.test(lower)).map(([d]) => d);
  if (foundDays.length > 0) {
    frequency = 'weekly';
    daysOfWeek = foundDays;
    matched = true;
  }

  // 2. Detect Time of Day
  // Matches "at 8:30 am", "at 9am", "at 14:00", "8am", "8:30pm", "at noon"
  const timeMatch = lower.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1], 10);
    const minute = timeMatch[2] ? timeMatch[2] : '00';
    const meridian = timeMatch[3];

    if (meridian === 'pm' && hour < 12) hour += 12;
    if (meridian === 'am' && hour === 12) hour = 0;

    if (hour >= 0 && hour <= 23) {
      timeOfDay = `${hour.toString().padStart(2, '0')}:${minute}`;
      matched = true;
    }
  }

  if (lower.includes('morning')) {
    if (!timeMatch) timeOfDay = '08:00';
    matched = true;
  } else if (lower.includes('evening')) {
    if (!timeMatch) timeOfDay = '18:00';
    matched = true;
  } else if (lower.includes('noon')) {
    timeOfDay = '12:00';
    matched = true;
  }

  return {
    matched,
    frequency,
    timeOfDay,
    daysOfWeek,
    confidence: matched ? 0.9 : 0.3,
  };
}

// ============================================================================
// 10. INITIAL DEFAULT EVERYDAY SCHEDULES
// ============================================================================

export const INITIAL_EVERYDAY_SCHEDULES: EverydayScheduleItem[] = (() => {
  const runMorning = computeNextScheduleRun({
    frequency: 'weekdays',
    timeOfDay: '08:00',
    scheduleId: 'sched-morning-briefing',
  });
  const runDaily = computeNextScheduleRun({
    frequency: 'every_day',
    timeOfDay: '08:30',
    scheduleId: 'sched-daily-plan',
  });
  const runTidy = computeNextScheduleRun({
    frequency: 'weekly',
    timeOfDay: '17:00',
    daysOfWeek: ['fri'],
    scheduleId: 'sched-tidy-downloads',
  });

  return [
    {
      id: 'sched-morning-briefing',
      title: 'Morning briefing',
      prompt: "Summarize today's Kyoto trip agenda, weather forecast, and transport notes.",
      frequency: 'weekdays',
      timeOfDay: '08:00',
      mode: 'do_for_me',
      channel: 'toast',
      missedRunPolicy: 'skip',
      enabled: true,
      nextRunLocal: runMorning.plainWords,
      nextRunEpochMs: runMorning.nextEpochMs,
      lastRunAt: 'Previous scheduled slot',
      lastRunStatus: 'done',
      advancedCron: runMorning.cronExpression,
      advancedUtcTimestamp: runMorning.utcIso,
      templateId: 'tpl-morning-briefing',
      requiresMoneyOrSensitive: false,
    },
    {
      id: 'sched-daily-plan',
      title: 'Daily plan',
      prompt: 'Review active project goals and build a prioritized to-do list for today.',
      frequency: 'every_day',
      timeOfDay: '08:30',
      mode: 'do_for_me',
      channel: 'chat',
      missedRunPolicy: 'skip',
      enabled: true,
      nextRunLocal: runDaily.plainWords,
      nextRunEpochMs: runDaily.nextEpochMs,
      lastRunAt: 'Previous scheduled slot',
      lastRunStatus: 'done',
      advancedCron: runDaily.cronExpression,
      advancedUtcTimestamp: runDaily.utcIso,
      templateId: 'tpl-daily-plan',
      requiresMoneyOrSensitive: false,
    },
    {
      id: 'sched-tidy-downloads',
      title: 'Tidy my downloads weekly',
      prompt: 'Check the downloads folder for files older than 30 days and suggest cleanup.',
      frequency: 'weekly',
      daysOfWeek: ['fri'],
      timeOfDay: '17:00',
      mode: 'do_for_me',
      channel: 'toast',
      missedRunPolicy: 'ask_me',
      enabled: true,
      nextRunLocal: runTidy.plainWords,
      nextRunEpochMs: runTidy.nextEpochMs,
      lastRunAt: 'Previous scheduled slot',
      lastRunStatus: 'done',
      advancedCron: runTidy.cronExpression,
      advancedUtcTimestamp: runTidy.utcIso,
      templateId: 'tpl-tidy-downloads',
      requiresMoneyOrSensitive: false,
    },
  ];
})();
