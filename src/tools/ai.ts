import { defineTool } from '@/core/registry';
import { RELEVANCE, type Action, type Result } from '@/core/types';
import { chatView } from '@/ui/views/chat-view';

// The AI tool is a plugin like any other: it offers an "Ask AI" result and,
// when chosen, swaps the list for a chat view. Requests go to the
// OpenAI-compatible endpoint configured in settings, from the background.

const QUESTION_START = /^(who|what|when|where|why|how|which|is|are|can|could|should|would|does|do|did|explain|summarize|summarise|write|draft|compare|translate|tell me|give me|help me)\b/i;

/** Natural-language questions get a higher band; anything else keeps AI as a low fallback. */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.endsWith('?') && t.split(/\s+/).length >= 3) return true;
  return QUESTION_START.test(t) && t.split(/\s+/).length >= 4;
}

function askResult(id: string, title: string, subtitle: string, prompt: string, relevance: number, withPage = false): Result {
  return {
    id,
    kind: 'ai',
    title,
    subtitle,
    icon: { glyph: 'sparkle' },
    relevance,
    actions: [
      { title: withPage ? 'Ask about this page' : 'Ask AI', run: (ctx) => ctx.showView(chatView({ prompt, includePage: withPage })) },
      ...(withPage ? [] : [{ title: 'Ask about this page', run: (ctx) => ctx.showView(chatView({ prompt, includePage: true })) } satisfies Action]),
    ],
  };
}

export default defineTool({
  id: 'ai',
  name: 'AI chat',
  description: 'Ask any OpenAI-compatible model, optionally about the current page. Uses your own key.',
  examples: ['ai explain this regex ^\\d+$', 'why is the sky blue?', 'summarize this page'],
  async match(q, ctx) {
    if (q.isEmpty) {
      const results = [askResult('page', 'Ask about this page', 'Summarize, explain or question what you are reading', '', RELEVANCE.partial + 0.05, true)];
      const last = await ctx.data.lastChat().catch(() => null);
      if (last) {
        results.unshift({
          id: 'resume',
          kind: 'ai',
          title: 'Continue chat',
          subtitle: last,
          icon: { glyph: 'sparkle' },
          relevance: RELEVANCE.partial + 0.06,
          actions: [{ title: 'Open chat', run: (c) => c.showView(chatView({ resume: true })) }],
        });
      }
      return results;
    }
    if (q.text.startsWith('>')) return null;
    const explicit = q.command('ai', 'ask', 'chat', 'gpt');
    if (explicit !== null) {
      return askResult('explicit', explicit || 'New chat', 'Ask AI', explicit, RELEVANCE.explicit);
    }
    if (q.is('summarize this page', 'summarise this page', 'tldr', 'tl;dr', 'explain this page', 'summarize page')) {
      return askResult('summarize', 'Summarize this page', 'Ask AI about the current page', 'Summarize this page in a few bullet points.', RELEVANCE.explicit, true);
    }
    const question = looksLikeQuestion(q.text);
    return askResult('ask', q.text, 'Ask AI', q.text, question ? RELEVANCE.strong + 0.02 : RELEVANCE.partial);
  },
});
