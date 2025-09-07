// LunarRank v2 - Next-Gen Search Ranking Algorithm
// -------------------------------------------------
// Core ideas:
//  • Pure exponential-decay frecency (no buckets)
//  • Visit-type bonuses (typed > bookmark > link …)
//  • Semantic fuzzy matching (typo tolerant + simple semantic overlap)
//  • Intent / keyword detection for quick-answer utilities
//  • Lightweight personalization (adaptive history)
//  • Context boosts (time-of-day, pinned tabs, etc.)
//  • All weights and half-life are configurable via CATEGORY_BASE & CONFIG
//
//  Candidates are plain JS objects produced by search.js – we just score & sort.
//  The public entry point is window.rankResults(candidates, query).

(function () {
    const DAY_MS = 86400000;

    // ---------------------------------------------------------------------
    // Configuration – tweak here to taste / A-B test.
    // ---------------------------------------------------------------------
    const CONFIG = {
        halfLifeDays: 30,      // Frecency half-life (non-nav)
        bookmarkBoost: 1.4,
        pinnedTabBoost: 1000,
        richResultBonus: 500,
        recentVisitBoost: 500, // <24h
        adaptiveLearningWeight: 300, // max boost from adaptive pick history
        autofillPriorityBoost: 50000, // ensure autofill wins
        openDomainBoostPerTab: 1200,  // bonus per open tab on that domain
    };

    // Visit-type bonus mapping (inspired by Firefox defaults, scaled down)
    const VISIT_BONUS = {
        typed: 200,
        bookmark: 140,
        link: 100,
        redirect_perm: 50,
        redirect_temp: 25,
        download: 0,
        embed: 0,
        default: 0,
    };

    // Base category priority (higher = better)
    const CATEGORY_BASE = {
        quick_answer: 12000,     // calc, convert etc.
        app_search: 10000,
        navigation: 9800,
        google: 9700,            // Google search as a primary action
        pinned_tab: 9600,
        ai: 9500,                // AI is a powerful fallback
        tab: 9400,
        history: 8500,
        bookmark: 8400,
        suggestion: 6000,        // Other suggestions (from engines)
        remote: 2500,
    };

    // Keyword buckets to detect intent quickly
    const KEYWORDS = {
        ai: ["ai"], // handled with prefix logic in detectIntent
        calc: ["=", "+", "-", "*", "/"],
        convert: ["to", "in", "convert"],
        time: ["time", "clock", "timezone"],
        setting: ["setting", "settings", "prefs"],
    };

    // Adaptive memory (simple map: queryPrefix -> {type -> count})
    let adaptiveStats = {};
    try {
        adaptiveStats = JSON.parse(localStorage.getItem("lunar_adaptive") || "{}");
    } catch (_) { adaptiveStats = {}; }

    // ---------------------------------------------------------------------
    // Helper functions
    // ---------------------------------------------------------------------

    // Simple Levenshtein for typo tolerance
    function levenshtein(a, b) {
        const dp = Array.from({ length: b.length + 1 }, () => []);
        for (let i = 0; i <= a.length; i++) dp[0][i] = i;
        for (let j = 1; j <= b.length; j++) {
            dp[j][0] = j;
            for (let i = 1; i <= a.length; i++) {
                dp[j][i] = Math.min(
                    dp[j - 1][i] + 1,
                    dp[j][i - 1] + 1,
                    dp[j - 1][i - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                );
            }
        }
        return dp[b.length][a.length];
    }

    function fuzzyStringSim(text, pattern) {
        if (!text || !pattern) return 0;
        text = text.toLowerCase();
        pattern = pattern.toLowerCase();
        if (text === pattern) return 1;
        if (text.startsWith(pattern)) return 0.9;
        if (text.includes(pattern)) return 0.7;
        const dist = levenshtein(text, pattern);
        const maxLen = Math.max(text.length, pattern.length);
        return 1 - dist / maxLen;
    }

    // Very light semantic boost: word overlap ratio (far cheaper than embeddings)
    function wordOverlapBonus(text, query) {
        const wordsA = new Set(text.toLowerCase().split(/[^a-z0-9]+/));
        const wordsB = new Set(query.toLowerCase().split(/[^a-z0-9]+/));
        let overlap = 0;
        wordsB.forEach(w => { if (wordsA.has(w)) overlap++; });
        return overlap / Math.max(1, wordsB.size);
    }

    function normalizeUrlForMatch(raw) {
        if (!raw) return '';
        let s = String(raw).trim().toLowerCase();
        // Remove scheme
        s = s.replace(/^https?:\/\//, '');
        // Remove common www prefix
        s = s.replace(/^www\./, '');
        return s;
    }

    function strictTabMatchFields(title, url, query) {
        if (!query) return 0;
        const q = String(query).toLowerCase().trim();
        if (!q) return 0;

        const titleNorm = String(title || '').toLowerCase();
        const urlFull = String(url || '').toLowerCase();
        const urlNorm = normalizeUrlForMatch(url);

        // Exact match (title or any url form)
        if (q === titleNorm || q === urlFull || q === urlNorm) return 1;

        // Strict prefix of title or URL (typed so far)
        if (titleNorm.startsWith(q)) return 0.95;
        if (urlFull.startsWith(q)) return 0.95;
        if (urlNorm.startsWith(q)) return 0.95;

        // No fuzzy/contains/word-boundary/acronym semantics allowed
        return 0;
    }

    function detectIntent(query) {
        const q = (query || '').toLowerCase().trim();
        // AI: only if explicitly prefixed or clearly natural language
        if (/^ai\b[:/]?\s*/.test(q)) return 'ai';
        // Calculator handled separately by detectors
        for (const [intent, list] of Object.entries(KEYWORDS)) {
            if (intent === 'ai') continue; // already handled
            if (list.some(k => q.includes(k))) return intent;
        }
        return null;
    }

    function looksLikeNaturalLanguageQuestion(query) {
        if (!query) return false;
        const q = query.toLowerCase().trim();
        if (/\?$/.test(q)) return true;
        // length-based heuristic
        return q.split(/\s+/).length >= 7 || q.length >= 40;
    }

    function domainPrefixMatchScore(domain, query) {
        if (!domain || !query) return 0;
        const dn = String(domain).toLowerCase().replace(/^www\./, '');
        const q = String(query).toLowerCase().trim();
        return dn.startsWith(q) ? 1 : 0;
    }

    // Exponential-decay frecency
    const LAMBDA = Math.log(2) / CONFIG.halfLifeDays;
    function frecencyScore(cand) {
        // history, bookmark, navigation types only
        const now = Date.now();
        if (cand.type === "navigation" && cand.visitCount) {
            const ageDays = (now - (cand.lastVisit || now)) / DAY_MS;
            const base = cand.visitCount * 10;
            const recencyBoost = ageDays < 1 ? CONFIG.recentVisitBoost : 0;
            return base * Math.exp(-LAMBDA * ageDays) + recencyBoost;
        }
        if (cand.type === "history" || cand.type === "bookmark") {
            const freq = cand.freq || 0;
            if (!freq) return 0;
            const ageDays = (now - (cand.last || now)) / DAY_MS;
            return freq * 100 * Math.exp(-LAMBDA * ageDays);
        }
        return 0;
    }

    // Adaptive boost – based on past selections (localStorage)
    function adaptiveBoost(cand, query) {
        const prefix = query.slice(0, 3).toLowerCase();
        const stats = adaptiveStats[prefix];
        if (stats && stats[cand.type]) {
            const max = Math.max(...Object.values(stats));
            return (stats[cand.type] / max) * CONFIG.adaptiveLearningWeight;
        }
        return 0;
    }

    // ---------------------------------------------------------------------
    // Scoring pipe
    // ---------------------------------------------------------------------

    function scoreCandidate(cand, query) {
        // 1. Base category score
        let base;
        switch (cand.type) {
            case "calculator": case "converter": case "time": case "color": case "qr": case "password": case "hash": case "url_shorten": case "ip_lookup": case "lorem": case "coin_flip": case "roll_die": case "random_number": case "user_agent": case "base64_encode": case "base64_decode":
                base = CATEGORY_BASE.quick_answer; break;
            case "app_search": base = CATEGORY_BASE.app_search; break;
            case "navigation": base = CATEGORY_BASE.navigation; break;
            case "google": base = CATEGORY_BASE.google; break;
            case "ai": base = CATEGORY_BASE.ai; break;
            case "tab": base = cand.pinned ? CATEGORY_BASE.pinned_tab : CATEGORY_BASE.tab; break;
            case "history": base = CATEGORY_BASE.history; break;
            case "bookmark": base = CATEGORY_BASE.bookmark; break;
            case "suggestion": base = CATEGORY_BASE.suggestion; break;
            default: base = CATEGORY_BASE.remote; break;
        }

        // 2. Match quality
        let matchScore = 0;
        if (cand.type === 'tab') {
            const title = cand.title || cand.text || "";
            const sim = strictTabMatchFields(title, cand.url || '', query);
            // Drop non-matching tabs entirely per strict requirement
            if (sim <= 0) return -Infinity;
            matchScore = sim * 1200; // make strict matches very strong
        } else if (cand.type === 'navigation') {
            // Strict domain prefix only for navigation
            const navSim = domainPrefixMatchScore(cand.domain || '', query);
            const hasQuery = Boolean(query && String(query).trim());
            // Drop non-matching navigation when a query exists
            if (hasQuery && navSim === 0) return -Infinity;
            // For autofill, require strict prefix
            if (cand.autofill) {
                if (navSim < 1) return -Infinity; // drop if not strict prefix
                // Grant a big match score to dominate non-nav items
                matchScore = 20000;
            } else {
                matchScore = navSim * 1000; // strong but below autofill
            }
        } else {
            const text = cand.text || cand.title || "";
            const sim = fuzzyStringSim(text, query);
            const overlap = wordOverlapBonus(text, query);
            matchScore = (sim * 400) + (overlap * 200);
        }

        // 2.5. Question Bonus for AI (prefer explicit AI prefix or natural questions)
        const isQuestion = looksLikeNaturalLanguageQuestion(query);
        let questionBonus = 0;
        if (cand.type === 'ai' && isQuestion) {
            questionBonus = 3000; // Boosts AI score to ~12500, above even quick_answers for questions
        }

        // 3. Intent bonus
        const intent = detectIntent(query);
        let intentBonus = 0;
        if (intent === "ai" && cand.type === "ai") intentBonus = 2000; // stronger when explicitly prefixed
        else if (intent === "calc" && cand.type === "calculator") intentBonus = 350;
        else if (intent === "convert" && cand.type === "converter") intentBonus = 300;
        else if (intent === "time" && cand.type === "time") intentBonus = 250;
        else if (intent === "setting" && cand.type === "setting") intentBonus = 250;

        // 4. Frecency / history relevance
        const frec = frecencyScore(cand);

        // 5. Rich content bonus
        const rich = cand.description ? CONFIG.richResultBonus : 0;

        // 6. Pinned tab bonus / open domain bonus
        const pinned = cand.pinned ? CONFIG.pinnedTabBoost : 0;
        const openDomain = (cand.type === 'navigation' && cand.openCount) ? (cand.openCount * CONFIG.openDomainBoostPerTab) : 0;

        // 7. Adaptive personalization
        const adaptive = adaptiveBoost(cand, query);

        // 8. Remote suggestion penalty
        const remotePenalty = (cand.type === "suggestion" && cand.remoteRank !== undefined) ? -cand.remoteRank * 10 : 0;

        // 6.5. Recency tag bonus (prefer labeled recent actions)
        const recencyTagBonus = (cand.recentlyVisited ? 1800 : 0) + (cand.recentlySearched ? 900 : 0);

        // 6.6. Autofill priority boost (ensures top placement when present)
        const autofillPriority = (cand.type === 'navigation' && cand.autofill) ? CONFIG.autofillPriorityBoost : 0;

        cand._debug = { base, matchScore, questionBonus, intentBonus, frec, rich, pinned, openDomain, adaptive, remotePenalty, recencyTagBonus, autofillPriority }; // for debugging
        return base + matchScore + questionBonus + intentBonus + frec + rich + pinned + openDomain + adaptive + remotePenalty + recencyTagBonus + autofillPriority;
    }

    // ---------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------

    window.rankResults = function (cands, query) {
        if (!query || !query.trim()) {
            // Empty query: pinned + recent tabs by lastAccessed (descending)
            return cands.filter(c => c.type === "tab")
                .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.lastAccessed - a.lastAccessed)
                .slice(0, 10);
        }

        // Filter trivial mismatches early (simulate cheap relevance)
        let prelim = cands.filter(c => {
            // For navigation, keep for now; later scoring may drop
            if (c.type === 'navigation') return true;
            // Tabs must pass strict title/URL prefix or equality
            if (c.type === 'tab') {
                return strictTabMatchFields(c.title || c.text || '', c.url || '', query) > 0;
            }
            // Other types keep previous fuzzy gating
            return fuzzyStringSim(c.text || c.title || "", query) > 0.3 || c.type === "ai" || c.type === "calculator";
        });

        prelim.forEach(c => { c.score = scoreCandidate(c, query); });
        // Remove any dropped candidates
        prelim = prelim.filter(c => Number.isFinite(c.score));

        prelim.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            // tie-breakers
            if (b.frec && a.frec && b.frec !== a.frec) return b.frec - a.frec;
            return (a.text || a.title || "").localeCompare(b.text || b.title || "");
        });

        return prelim.slice(0, 10);
    };

    // ---------------------------------------------------------------------
    // Adaptive stats update helper – call from search.js when user clicks.
    // ---------------------------------------------------------------------
    window.__lunarUpdateAdaptive = function (candidate, query) {
        const prefix = query.slice(0, 3).toLowerCase();
        adaptiveStats[prefix] = adaptiveStats[prefix] || {};
        adaptiveStats[prefix][candidate.type] = (adaptiveStats[prefix][candidate.type] || 0) + 1;
        localStorage.setItem("lunar_adaptive", JSON.stringify(adaptiveStats));
    };
})(); 
