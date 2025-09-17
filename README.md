# MoonCow: a fast, messy, lovable search bar for Firefox (alpha)

MoonCow is my take on the Zen and Arc command palette, but actually useful. It’s a Firefox extension (works great in Zen, which I daily drive) that gives you a beautiful search bar with smart ranking, shortcuts, and in-panel widgets that make your browser feel like it leveled up. The philosophy is simple: minimize the total actions to get to the goal. Every commit tries to shave steps.

It’s very alpha. It works. It’s buggy. You’ll find stuff. Please file issues and PRs. I’d rather ship than let it rot on my machine for another month.

## Why this exists
- **Lightweight command bar:** quick open, fuzzy search, and smart defaults. It tries to guess what you want before you hit enter.
- **In-panel widgets:** everything lives inside the panel (color picker, AI chat, readers, little helpers). The panel expands to fit, and you can keep searching while a widget is open. It feels smooth.
- **Free but good AI:** built-in AI chat with tool use and web search. Uses providers with generous free tiers (Cerebras, Google Gemini, Jina, and more). You can chat for hours before hitting limits, and you can swap providers if you do. No sketchy paywalls.
- **Agentic tools:** the AI can search, read pages, and use tools. It works without a Google key, and it gets better if you add one. Cerebras doesn’t handle images yet, so screenshot workflows stick to providers that support them.

## Status (read this)
- Alpha. There are bugs. I use it daily anyway.
- Around 15k LOC with a lot of moving parts, but it runs smoothly on a base M1 Air.
- If you’ve got a 2013 toaster with 50 tabs, this might not be ideal. On modern setups it’s chill.

## Features (highlights)
- **Smart ranking:** predicts intent before you press enter. Not perfect, getting better.
- **Zen and Arc vibes:** clean, dark, glassy UI. Looks good. Plays nice with your theme.
- **In-panel widgets:** AI chat, color picker, readers, and more, all inline.
- **Adaptive search:** app-specific shortcuts and context-aware actions.
- **Tool-using AI:** web search and page reading via Jina Reader, Google, and others.
- **Free-tier friendly:** pick providers with generous limits, then swap when throttled.

## Keys and privacy
- You add keys locally in the extension settings panel. Stored in extension storage for now. Not encrypted yet. I’ll fix that in a PR.
- Supported keys you can add (optional, but recommended):
  - **Cerebras API key** for chat completions
  - **Google Gemini API key** for models and better image input
  - **Google Custom Search API + CSE CX** for Google Web (annoying to set up, very worth it)
  - **Jina API key** for Reader and Search (free is nice, fetch errors are not — I’ll improve this)

## Install (Firefox and Zen)
1. Clone the repo.
2. In Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → pick `manifest.firefox.json`.  
   Firefox will load the folder even if you click a random file inside it.
3. Open the command bar (keyboard shortcut or icon), go to Settings, and paste keys if you have them.

Note: Firefox-first for now because Zen is my daily driver. Chromium support is on the table later.

## Dev quickstart
- Code lives in a few chunky files:
  - `search.js` for the core search bar, ranking, and UI glue
  - `chat.js` for AI chat and tools orchestration
  - `tools/` for Jina, Google, and Cerebras helpers
  - `ranking.js` for ranking logic
- I need to refactor. I tab-completed my way into a small jungle. PR incoming.
- Run as a temporary extension in Firefox while developing.

## Roadmap (rough)
- Stabilize ranking and edge cases
- Broader provider support and image input parity
- Better ranking and algos
- Better settings UX
- More useful widgets (notes, tiny calculators, etc.)
- Trim resource use (hard)
- Improve agent behavior (Qwen can be a gremlin)
- UI upgrade (liquid glass would be sick — Firefox limitations are a thing, maybe when I drop the Chrome version)

## Contributing
- Open bugs with clear repro steps. Short repro videos help a ton.
- PRs are welcome, especially for weird edge cases I haven’t hit yet.
- Be kind. This is a nights-and-weekends project that snowballed. I’m working to make it genuinely useful. It’s my daily driver and I hope it becomes yours too.

## License
MIT. Use it, fork it, ship your own flavor.
