import { copyAction, openAction, openInNewTabAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type Result } from '@/core/types';
import { answer, favicon } from './_helpers';

export function trackingUrl(code: string): { carrier: string; url: string } | null {
  const c = code.replace(/\s+/g, '').toUpperCase();
  if (/^1Z[0-9A-Z]{16}$/.test(c)) return { carrier: 'UPS', url: `https://www.ups.com/track?tracknum=${c}` };
  if (/^(94|93|92|95)\d{20}$/.test(c) || /^[A-Z]{2}\d{9}US$/.test(c)) return { carrier: 'USPS', url: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${c}` };
  if (/^\d{12}$/.test(c) || /^\d{15}$/.test(c)) return { carrier: 'FedEx', url: `https://www.fedex.com/fedextrack/?trknbr=${c}` };
  return null;
}

export default defineTool({
  id: 'misc',
  name: 'Odds and ends',
  description: 'Your public IP, user agent, GitHub repos, email drafts and package tracking.',
  examples: ['my ip', 'user agent', 'gh wxt-dev/wxt', 'email someone@example.com', '1Z999AA10123456784'],
  match(q) {
    if (q.is('ip', 'my ip', 'what is my ip', "what's my ip", 'ip address', 'public ip')) {
      return {
        id: 'ip',
        kind: 'answer',
        title: 'Public IP address',
        answer: '…',
        subtitle: 'Looked up via api.ipify.org',
        icon: { glyph: 'globe' },
        relevance: RELEVANCE.explicit,
        actions: [],
        async hydrate(ctx) {
          const { ip } = await ctx.fetchJson<{ ip: string }>('https://api.ipify.org?format=json');
          return { answer: ip, accessory: 'Copy', actions: [copyAction(ip)] };
        },
      } satisfies Result;
    }
    if (q.is('user agent', 'useragent', 'ua', 'my user agent', 'browser version')) {
      return answer({ id: 'ua', title: 'User agent', answer: navigator.userAgent, glyph: 'text', relevance: RELEVANCE.explicit });
    }
    const repo = q.match(/^gh\s+([\w.-]+\/[\w.-]+)$/i);
    if (repo) {
      const url = `https://github.com/${repo[1]}`;
      return { id: 'gh', kind: 'navigation', title: repo[1], subtitle: 'Open on GitHub', url, icon: favicon('github.com'), relevance: RELEVANCE.explicit, actions: [openAction(url), openInNewTabAction(url)] };
    }
    const email = q.match(/^(?:email|mail)\s+([^\s@]+@[^\s@]+\.[a-z]{2,})(?:\s+(.*))?$/i);
    if (email) {
      const subject = email[2] ? `?subject=${encodeURIComponent(email[2])}` : '';
      return { id: 'email', kind: 'command', title: `Email ${email[1]}`, subtitle: email[2] ? `Subject: ${email[2]}` : 'Opens your mail app', icon: { glyph: 'mail' }, relevance: RELEVANCE.explicit, actions: [openAction(`mailto:${email[1]}${subject}`, 'Compose')] };
    }
    const track = trackingUrl(q.text);
    if (track && !/\s/.test(q.text.trim())) {
      // Bare 12/15-digit numbers are ambiguous, so FedEx stays below web search.
      const relevance = track.carrier === 'FedEx' ? RELEVANCE.partial : RELEVANCE.parsed;
      return { id: 'track', kind: 'command', title: `Track ${track.carrier} package`, subtitle: q.text, icon: { glyph: 'box' }, relevance, actions: [openAction(track.url, `Track on ${track.carrier}`)] };
    }
    return null;
  },
});
