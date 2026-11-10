// The MoonCow tool API.
//
// Everything the palette can do is a Tool: the calculator, the unit converter,
// tab switching, web search, the AI chat. Built-ins use exactly this interface,
// so a tool you write is a peer of the shipped ones. See README.md
// ("Writing a tool") and src/tools/dice.ts for a worked example.

import type { Query } from './query';

export type { Query };

/** What a result looks like at the left edge of its row. */
export type Icon =
  | { glyph: GlyphName }
  /** The favicon for a page, resolved locally by the palette (never via a third-party service). */
  | { site: string }
  | { image: string }
  | { swatch: string };

export type GlyphName =
  | 'calc' | 'convert' | 'color' | 'book' | 'cloud' | 'clock' | 'search' | 'globe'
  | 'sparkle' | 'tab' | 'history' | 'bookmark' | 'key' | 'hash' | 'dice' | 'text'
  | 'gear' | 'reload' | 'copy' | 'link' | 'qr' | 'mail' | 'code' | 'box' | 'camera';

/**
 * Broad category of a result. Ranking is driven by `relevance`; `kind` only
 * breaks ties and picks the row style ("answer" rows render the answer large).
 */
export type ResultKind =
  | 'answer' | 'command' | 'tab' | 'navigation' | 'bookmark' | 'history'
  | 'search' | 'suggestion' | 'ai';

export interface Result {
  /** Stable id, unique within the tool. Used to keep selection steady while results stream in. */
  id: string;
  title: string;
  subtitle?: string;
  /** Large value for answer rows (calculator output, conversions). */
  answer?: string;
  /** Short text on the right edge, e.g. "Open tab" or a shortcut hint. */
  accessory?: string;
  icon?: Icon;
  /** The page this result leads to, if any. Results with the same URL are merged. */
  url?: string;
  kind: ResultKind;
  /**
   * How sure the tool is that this is what the user wants, from 0 to 1.
   * Use the bands in RELEVANCE so tools stay comparable with each other.
   */
  relevance: number;
  /** First action runs on Enter; the second on Mod+Enter; all are listed in the action menu (Mod+K). */
  actions: Action[];
  /**
   * Optional live data. Called once after the result is shown; resolve with
   * fields to patch (for example the fetched definition). Aborted when the
   * query changes.
   */
  hydrate?: (ctx: HydrateContext) => Promise<Partial<Omit<Result, 'id' | 'hydrate'>> | null>;
  /** Set by the registry: which tool produced this result. */
  toolId?: string;
  /** Set by ranking. */
  score?: number;
}

/**
 * Relevance bands. Pick the band that describes how the query matched, then
 * adjust within it. A tool that matches loosely must never claim a high band:
 * that is how "back to the future" ends up running "Go back".
 */
export const RELEVANCE = {
  /** The user typed this tool's command explicitly ("define cat", "@yt lofi", "=2+2"). */
  explicit: 0.95,
  /** The whole query parses as this tool's input ("2+2*3", "10 km to mi", "#ff8800"). */
  parsed: 0.9,
  /** Strong match against the user's own data (open tab, typed-domain autofill). */
  strong: 0.8,
  /** Always-available fallbacks such as web search. */
  fallback: 0.7,
  /** Partial or fuzzy matches. */
  partial: 0.5,
  /** Remote suggestions and other filler. */
  weak: 0.3,
} as const;

export interface Action {
  title: string;
  run(ctx: ActionContext): void | Promise<void>;
}

/** Everything an action may do to the outside world. */
export interface ActionContext {
  /** Close the palette. */
  close(): void;
  copy(text: string): Promise<void>;
  /** Open a URL in the current tab, or a new one with `newTab`. Closes the palette. */
  open(url: string, options?: { newTab?: boolean }): Promise<void>;
  /** Replace the result list with a richer view (chat, color picker). Esc returns to the list. */
  showView(view: View): void;
  /** Replace the query text. */
  setQuery(text: string): void;
  /** Run the current query again (for results that change each time, like dice). */
  refresh(): void;
  /** Brief confirmation at the bottom of the palette. */
  toast(message: string): void;
  browser: BrowserBridge;
}

/**
 * Operations on the browser. `tabId` defaults to the tab the palette was
 * opened over, so "Reload page" and "Close tab" on a tab row share one call.
 */
export interface BrowserBridge {
  switchToTab(tabId: number, windowId?: number): Promise<void>;
  tabAction(action: TabAction, tabId?: number): Promise<void>;
  restoreClosed(sessionId?: string): Promise<void>;
  deleteHistory(url: string): Promise<void>;
  pageInfo(): Promise<{ url: string; title: string } | null>;
  pageText(): Promise<string>;
  openOptions(): Promise<void>;
  setTheme(theme: ThemeSetting): Promise<void>;
}

export type TabAction =
  | 'reload' | 'hard-reload' | 'duplicate' | 'pin' | 'unpin' | 'mute' | 'unmute'
  | 'close' | 'close-others' | 'close-right' | 'close-duplicates' | 'new-tab' | 'new-window'
  | 'move-to-new-window' | 'back' | 'forward' | 'bookmark' | 'view-source' | 'screenshot';

/** A view takes over the panel body. Return a cleanup function if you set up listeners. */
export interface View {
  id: string;
  title: string;
  mount(root: HTMLElement, ctx: ViewContext): void | (() => void);
}

export interface ViewContext extends ActionContext {
  /** Leave the view and go back to the result list. */
  back(): void;
  /** Every registered tool, for views that describe what the palette can do. */
  tools: readonly Tool[];
  settings: Readonly<Settings>;
}

export interface HydrateContext {
  signal: AbortSignal;
  fetchJson<T = unknown>(url: string): Promise<T>;
}

/** Read-only data a tool may consult while matching. */
export interface ToolContext {
  /** Aborted as soon as the query changes; pass it to fetch. */
  signal: AbortSignal;
  now: number;
  settings: Readonly<Settings>;
  data: DataSource;
}

export interface DataSource {
  tabs(): Promise<TabInfo[]>;
  history(text: string): Promise<HistoryInfo[]>;
  bookmarks(text: string): Promise<BookmarkInfo[]>;
  suggestions(text: string): Promise<string[]>;
  recentlyClosed(): Promise<ClosedTabInfo[]>;
  /** Domains from the last 14 days of history, with how you use them. Cached by the palette. */
  sites(): Promise<SiteInfo[]>;
  /** Title of the saved AI conversation, if there is one. */
  lastChat(): Promise<string | null>;
}

export interface SiteInfo {
  domain: string;
  visitCount: number;
  typedCount: number;
  lastVisitTime: number;
  /** Distinct days in the window with at least one visit: steady use beats a single binge. */
  daysActive: number;
  /** Open tabs on this domain right now. */
  openCount: number;
}

export interface ClosedTabInfo {
  sessionId: string;
  title: string;
  url: string;
  closedAt: number;
  favIconUrl?: string;
}

export interface TabInfo {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  pinned: boolean;
  active: boolean;
  audible: boolean;
  muted: boolean;
  lastAccessed: number;
}

export interface HistoryInfo {
  url: string;
  title: string;
  visitCount: number;
  typedCount: number;
  lastVisitTime: number;
}

export interface BookmarkInfo {
  url: string;
  title: string;
}

export type ThemeSetting = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemeSetting;
  /** Fetch search suggestions from Google as you type. Off by default: it sends keystrokes to Google. */
  suggestions: boolean;
  /** Show the full-size bar on new tabs (Chromium; Firefox uses its own Home setting). */
  newTabPage: boolean;
  ai: AiSettings;
}

export interface AiSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Sent as `reasoning_effort` only when set; many compatible servers reject unknown fields. */
  reasoningEffort: '' | 'none' | 'low' | 'medium' | 'high';
}

export interface Tool {
  /** Stable, unique, kebab-case. Used for adaptive ranking and settings. */
  id: string;
  name: string;
  /** One line, shown in the help list ("?"). */
  description: string;
  /** Example queries, shown in the help list and used in tests. */
  examples?: string[];
  /**
   * Return results for the query, or null. Runs on every keystroke, so keep
   * the synchronous part cheap and push network work into `hydrate` or an
   * async return value. Returning a Promise is fine; results stream in.
   */
  match(query: Query, ctx: ToolContext): MatchReturn | Promise<MatchReturn>;
}

export type MatchReturn = Result | Result[] | null | undefined;
