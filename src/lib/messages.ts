// Message shapes shared by the palette, the content script and the background.
import type { ChatMessage } from './openai';

/** runtime.sendMessage requests handled by the background. */
export type BackgroundRequest =
  | { type: 'whoami' }
  | { type: 'open-options' }
  | { type: 'has-origin'; pattern: string }
  | { type: 'screenshot'; windowId: number };

/** tabs.sendMessage requests handled by the content script. */
export type ContentRequest = { type: 'mooncow:toggle' } | { type: 'mooncow:page-text' };

export interface PageText {
  url: string;
  title: string;
  text: string;
  /** Whatever the user had selected when they asked. */
  selection: string;
}

/** window.postMessage between the palette iframe and the content script. */
export type FrameMessage =
  | { mooncow: 'open' }
  | { mooncow: 'close' }
  | { mooncow: 'ready' };

export const AI_PORT = 'mooncow-ai';

export interface AiRequest {
  type: 'ask';
  messages: ChatMessage[];
  includePage: boolean;
  tabId: number | null;
}

export type AiEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'page'; title: string; url: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface SavedChat {
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export const CHAT_KEY = 'chat';
export const PICKS_KEY = 'picks';
