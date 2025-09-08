# MoonCow — a fast, messy, lovable search bar for Firefox (alpha)

MoonCow is my take on the Zen/Arc-style command palette… but actually useful. It’s a Firefox extension (works great in Zen, which I daily drive) that gives you a beautiful search bar with smart ranking, shortcuts, and in-chat widgets that make your browser feel like it leveled up.

It’s very alpha. It works. It’s buggy. You’ll find stuff. Please file issues and PRs. I’ll be squashing bugs, but I wanted to ship this instead of letting it rot on my machine for another month.

## Why this exists
- **Lightweight command bar**: quick open, fuzzy search, and smart defaults. It tries to guess what you want before you hit enter.
- **In-chat widgets**: everything lives inside the panel — color picker, AI chat, readers, little helpers. The panel expands to fit, and you can keep searching while a widget is open. It feels… smooth.
- **Free-but-good AI**: built-in AI chat with tool-use and web search. Uses providers with generous free tiers (Cerebras, Google Gemini, Jina, etc.). You can chat for hours before hitting limits, and you can swap providers if you do. No sketchy paywalls.
- **Agentic tools**: the AI can search, read pages, and use tools. Even without a Google key it still works; with a key it’s better. Cerebras doesn’t do images (yet), so the screenshot path is gated to providers that support it.

## Status (read this)
- Alpha. There are bugs. I use it daily anyway.
- ~15k+ LOC and a lot of moving parts, but it runs smoothly on my base M1 Air.
- If you’ve got a 2013 toaster with 50 tabs… maybe not ideal. On modern setups it’s chill.

## Features (highlights)
- **Smart ranking**: tries to predict intent before you press enter. Not perfect, getting better.
- **Zen/Arc vibes**: clean, dark, glassy UI. Looks good. Doesn’t fight your theme.
- **In-chat widgets**: AI chat, color picker, readers, and more — all inline.
- **Adaptive search**: app-specific shortcuts and context-aware actions.
- **Tool-using AI**: web search + page reading via Jina Reader, Google, etc.
- **Free-tier friendly**: pick providers with generous limits; swap when throttled.

## Keys and privacy
- No keys are hardcoded. You add your keys locally in the extension settings panel.
- Supported keys you can add (optional, but recommended):
  - **Cerebras API key** (chat completions)
  - **Google Gemini API key** (models, better for image input)
  - **Google Custom Search API + CSE CX** (Google Web)
  - **Jina API key** (Reader/Search)
- You can use most stuff without keys. Keys just unlock faster/better results.

## Install (Firefox / Zen)
1. Clone the repo.
2. Firefox: about:debugging → This Firefox → Load Temporary Add-on… → pick `manifest.firefox.json` (or `manifest.json` for Chromium-like builds).
3. Open the command bar (keyboard shortcut or icon) and go to Settings → paste keys if you have them.

Note: This is a for-now Firefox-first project because Zen is my daily driver. Chromium support is on the table later.

## Dev quickstart
- Code lives in a few chunky files:
  - `search.js` — core search bar, ranking, UI glue
  - `chat.js` — AI chat + tools orchestration
  - `tools/` — Jina/Google/Cerebras helpers
  - `ranking.js` — ranking logic
- Run as a temporary extension in Firefox while developing.
- Keys are stored in extension storage; nothing is hardcoded.

## Roadmap (rough)
- Stabilize ranking and edge-cases
- Broader provider support + image input parity
- Better settings UX
- More widgets (notes, tiny calculators, whatever is actually useful)

## Contributing
- Open bugs with clear repro steps; small repro videos help a ton.
- PRs are welcome — especially for ugly edge cases I haven’t hit yet.
- Be nice. This is a nights-and-weekends thing that somehow snowballed.

## License
MIT. Use it, fork it, ship your own flavor.

---

PS: If the AI starts acting like an over-eager intern, that’s on me. Tuning continues. And yes, I know it’s “Cerebras,” I just keep typing “Cerebus.” Old habits.
