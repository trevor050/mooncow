# MoonCow: a fast, messy, lovable search bar for Firefox (alpha)

MoonCow is my take on the Zen and Arc command palette, but actually useful. It’s a Firefox extension (works great in Zen, which I daily drive) that gives you a beautiful search bar with smart ranking, shortcuts, and in-panel widgets that make your browser feel like it leveled up. I have a very clear philosphy with it: Minimize total actions required to get to the goal. That is what literally every commit, change, and update that I put out has been to try and get closer to that goal

It’s very alpha. It works. It’s buggy. You’ll find stuff. Please file issues and PRs. I’m squashing bugs when I can, but I’d rather ship than let it rot on my machine for another month.

## Why this exists
- **Lightweight command bar:** quick open, fuzzy search, and smart defaults. It tries to guess what you want before you hit enter.
- **In-panel widgets:** everything lives inside the panel (color picker, AI chat, readers, little helpers). The panel expands to fit, and you can keep searching while a widget is open. It feels smooth.
- **Free but good AI:** built-in AI chat with tool use and web search. Uses providers with generous free tiers (Cerebras, Google Gemini, Jina, and more). You can chat for hours before hitting limits, and you can swap providers if you do. No sketchy paywalls.
- **Agentic tools:** the AI can search, read pages, and use tools. It works without a Google key, and it gets better if you add one. Cerebras does not handle images yet, so screenshot workflows stick to providers that support them.

## Status (read this)
- Alpha. There are bugs. I use it daily anyway.
- Around 15k LOC with a lot of moving parts, but it runs smoothly on my base M1 Air.
- If you’ve got a 2013 toaster with 50 tabs, this may not be ideal. On modern setups it’s chill. I think I should be able to optimize it further but I have not much experience with this I'll admit

## Features (highlights)
- **Smart ranking:** predicts intent before you press enter. Not perfect, getting better.
- **Zen and Arc vibes:** clean, dark, glassy UI. Looks good. Plays nice with your theme.
- **In-panel widgets:** AI chat, color picker, readers, and more, all inline.
- **Adaptive search:** app-specific shortcuts and context-aware actions.
- **Tool-using AI:** web search and page reading via Jina Reader, Google, and others.
- **Free-tier friendly:** I picked providers with generous limits, then hotswap accounts if you (somehow) hit limits.

## Keys and privacy
- You add keys locally in the extension settings panel, stored with localstorage. Currently not encrypted, so I will make sure to do that in a PR.
- Supported keys you can add (optional, but recommended):
  - **Cerebras API key** for chat completions
  - **Google Gemini API key** for models and better image input
  - **Google Custom Search API + CSE CX** for Google Web (these ones, while annoying to grab make the search so much better)
  - **Jina API key** for Reader and Search (I need to improve Jina, I will not lie. Its nice because its free, but it sucks because it loves to toss fetch errors. I have ideas on how to fix tho)


## Install (Firefox and Zen)
1. Clone the repo.
2. In Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → pick `manifest.firefox.json` (Though from testing I think you can click any file in the Mooncow folder).
3. Open the command bar (keyboard shortcut or icon), go to Settings, and paste keys if you have them.

Note: this is Firefox-first for now because Zen is my daily driver. Chromium support is on the table later.

## Dev quickstart
- Code lives in a few chunky files:
  - `search.js` for the core search bar, ranking, and UI glue
  - `chat.js` for AI chat and tools orchestration
  - `tools/` for Jina, Google, and Cerebras helpers
  - `ranking.js` for ranking logic
- Note: I need to refactor. I did way to tab complete and my code is a mess. Will do in a PR
- Run as a temporary extension in Firefox while developing.


## Roadmap (rough)
- Stabilize ranking and edge cases
- Broader provider support and image input parity
- Better ranking/algos
- Better settings UX
- More widgets that are actually useful (notes, tiny calculators, etc.)
- Minimizing resources (hard..)
- Improving agency (Qwen is.. a model)
- UI upgrade (I really want to do liquid glass, currently not possible on firefox. Or atleast I haven't seen a working implmentation of it. Maybe when I drop the chrome version..?)

## Contributing
- Open bugs with clear repro steps. Short repro videos help a ton.
- PRs are welcome, especially for weird edge cases I haven’t hit yet. 
- Be kind. This is a nights and weekends project that snowballed. I am going to work hard to make it useful. Its a daily driver for me and I hope you guys will end up feeling the same
  

## License
MIT. Use it, fork it, ship your own flavor.
