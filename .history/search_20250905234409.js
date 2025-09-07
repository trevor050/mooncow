const searchInput = document.getElementById('search-input');
const resultsDiv = document.getElementById('results');
const chatTileContainer = document.getElementById('chat-tile-container');
const dragHandle = document.getElementById('drag-handle');
const restoreChatButton = document.getElementById('restore-chat-button');
const pinButton = document.getElementById('pin-button');

let selectedIndex = -1;
let currentResults = [];
let isChatActive = false;
let chatHistory = null; // Global persistent chat history
let followupInput = null; // Reference to the follow-up input
let chatWasHidden = false; // Track if chat was hidden by typing
let isPinned = false;

// (moved) suggestionCache is declared near the top to avoid TDZ issues

// Chat AI provider settings
let aiProvider = 'cerebras'; // 'cerebras' or 'google'

// Chat history management
let chatSessions = new Map(); // Map of chatId -> chatSession
let currentChatId = null;
let chatHistoryDropdown = null;

// =====================================================
// Site Index (last 14 days) for strict URL autofill
// =====================================================

let siteIndex = null; // Array of { domain, visitCount, typedCount, lastVisitTime, openCount }
let siteIndexBuiltAt = 0;
const SITE_INDEX_TTL_MS = 6 * 60 * 60 * 1000; // rebuild every 6 hours

async function ensureSiteIndex() {
    const now = Date.now();
    if (siteIndex && (now - siteIndexBuiltAt) < SITE_INDEX_TTL_MS) return siteIndex;

    try {
        // Fetch recent history aggregated by domain
        const historyAgg = await browser.runtime.sendMessage({ action: "getRecentHistoryIndex" });
        // Fetch open tabs to boost domains with open tabs
        const tabs = await browser.runtime.sendMessage({ action: "searchTabs", query: "" });
        const openCounts = new Map();
        for (const tab of tabs || []) {
            if (!tab.url) continue;
            try {
                const host = new URL(tab.url).hostname.toLowerCase().replace(/^www\./, '');
                openCounts.set(host, (openCounts.get(host) || 0) + 1);
            } catch (_) {}
        }

        const merged = (historyAgg || []).map(h => ({
            domain: (h.domain || '').toLowerCase(),
            visitCount: h.visitCount || 0,
            typedCount: h.typedCount || 0,
            lastVisitTime: h.lastVisitTime || 0,
            pages: h.pages || 0,
            daysActive: h.daysActive || 0,
            openCount: openCounts.get((h.domain || '').toLowerCase()) || 0
        }));

        // Also include any open domains not present in recent history (e.g. about:blank won't parse)
        for (const [host, count] of openCounts.entries()) {
            if (!merged.find(x => x.domain === host)) {
                merged.push({ domain: host, visitCount: 0, typedCount: 0, lastVisitTime: now, openCount: count });
            }
        }

        siteIndex = merged;
        siteIndexBuiltAt = now;
        return siteIndex;
    } catch (e) {
        console.warn('Failed to build site index:', e);
        siteIndex = [];
        siteIndexBuiltAt = now;
        return siteIndex;
    }
}

function normalizeDomain(d) {
    return (d || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').trim();
}

function domainPrefixMatches(domain, query) {
    const dn = normalizeDomain(domain);
    const q = (query || '').toLowerCase().trim();
    if (!q) return false;
    // Only allow strict prefix; no fuzzy here
    return dn.startsWith(q);
}

function scoreDomainForAutofill(entry) {
    // Composite domain score for ordering within navigation
    // Components: open tabs, typed visits, visit count in last 14d, unique active days, and recency decay
    const now = Date.now();
    const ageDays = Math.max(0, (now - (entry.lastVisitTime || now)) / (1000*60*60*24));
    const halfLifeDays = 2.5; // aggressive recency for navigation
    const lambda = Math.log(2) / halfLifeDays;
    const recency = Math.exp(-lambda * ageDays); // 1 when now, ~0.01 after ~16d

    const openScore = (entry.openCount || 0) * 7000;
    const typedScore = (entry.typedCount || 0) * 1200;
    const visitsScore = (entry.visitCount || 0) * 300;
    const daysScore = Math.pow(entry.daysActive || 0, 1.2) * 3500; // prefer steady daily use
    const recencyScore = recency * 25000;

    return openScore + typedScore + visitsScore + daysScore + recencyScore;
}

async function getAutofillCandidates(query) {
    const q = (query || '').trim();
    if (!q) return [];
    // Avoid triggering on special prefixes (e.g., @app, calculator '=')
    if (q.startsWith('@') || q.startsWith('=')) return [];

    await ensureSiteIndex();
    if (!siteIndex || siteIndex.length === 0) return [];

    const matches = siteIndex
        .filter(e => domainPrefixMatches(e.domain, q))
        .sort((a, b) => scoreDomainForAutofill(b) - scoreDomainForAutofill(a))
        .slice(0, 3); // keep a small top set; ranker will ensure top overall

    return matches.map(m => {
        const domain = normalizeDomain(m.domain);
        const url = `https://${domain}`;
        return {
            type: 'navigation',
            autofill: true,
            title: `Go to ${domain}`,
            url,
            domain,
            visitCount: m.visitCount || 0,
            typedCount: m.typedCount || 0,
            lastVisit: m.lastVisitTime || 0,
            openCount: m.openCount || 0,
            favicon: `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
        };
    });
}

// =====================================================
// Search Detectors - Pattern Recognition & Natural Language
// =====================================================

window.searchDetectors = {
    // Math/Calculator Detection
    detectMath: function(query) {
        if (query.startsWith('=')) {
            const expr = query.slice(1).trim();
            try {
                const result = eval(expr);
                return { type: 'calculator', expression: expr, result, title: `Calculator: ${expr}`, answer: result.toString() };
            } catch (e) {
                return null;
            }
        }
        
        // Basic math patterns without =
        const mathPattern = /^[\d\s\+\-\*\/\(\)\.\^%]+$/;
        if (mathPattern.test(query) && /[\+\-\*\/]/.test(query)) {
            try {
                const result = eval(query);
                return { type: 'calculator', expression: query, result, title: `Calculator: ${query}`, answer: result.toString() };
            } catch (e) {
                return null;
            }
        }
        
        return null;
    },

    // App Search Detection (@commands)
    detectAppSearch: function(query) {
        const trimmed = query.trim();
        
        // Show app suggestions for just "@"
        if (trimmed === '@') {
            return {
                type: 'show_app_suggestions',
                apps: {
                    google: { name: 'Google', url: 'https://www.google.com/search?q=' },
                    youtube: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
                    twitter: { name: 'Twitter', url: 'https://twitter.com/search?q=' },
                    github: { name: 'GitHub', url: 'https://github.com/search?q=' },
                    reddit: { name: 'Reddit', url: 'https://www.reddit.com/search/?q=' },
                    stackoverflow: { name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=' },
                    amazon: { name: 'Amazon', url: 'https://www.amazon.com/s?k=' },
                    ebay: { name: 'eBay', url: 'https://www.ebay.com/sch/i.html?_nkw=' },
                    bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
                    duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' }
                }
            };
        }
        
        // Handle @service queries
        const appMatch = trimmed.match(/^@(\w+)\s*(.*)$/);
        if (appMatch) {
            const [, service, searchTerm] = appMatch;
            const serviceMap = {
                google: { name: 'Google', url: 'https://www.google.com/search?q=' },
                youtube: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
                twitter: { name: 'Twitter', url: 'https://twitter.com/search?q=' },
                github: { name: 'GitHub', url: 'https://github.com/search?q=' },
                reddit: { name: 'Reddit', url: 'https://www.reddit.com/search/?q=' },
                stackoverflow: { name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=' },
                amazon: { name: 'Amazon', url: 'https://www.amazon.com/s?k=' },
                ebay: { name: 'eBay', url: 'https://www.ebay.com/sch/i.html?_nkw=' },
                bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
                duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
                netflix: { name: 'Netflix', url: 'https://www.netflix.com/search?q=' },
                spotify: { name: 'Spotify', url: 'https://open.spotify.com/search/' },
                linkedin: { name: 'LinkedIn', url: 'https://www.linkedin.com/search/results/all/?keywords=' },
                maps: { name: 'Google Maps', url: 'https://www.google.com/maps/search/' },
                drive: { name: 'Google Drive', url: 'https://drive.google.com/drive/search?q=' },
                gmail: { name: 'Gmail', url: 'https://mail.google.com/mail/u/0/#search/' }
            };
            
            const serviceInfo = serviceMap[service.toLowerCase()];
            if (serviceInfo && searchTerm.trim()) {
                return {
                    type: 'app_search',
                    app: serviceInfo.name,
                    searchTerm: searchTerm.trim(),
                    url: serviceInfo.url + encodeURIComponent(searchTerm.trim()),
                    title: `Search ${serviceInfo.name} for "${searchTerm.trim()}"`
                };
            }
        }
        
        return null;
    },

    // IP Address Lookup
    detectIPLookup: function(query) {
        const patterns = [
            /\b(my ip|what is my ip|ip address|show my ip|get my ip|find my ip|check my ip|ip lookup|public ip|external ip|internet ip|current ip)\b/i
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                return {
                    type: 'ip_lookup',
                    title: 'Get My IP Address',
                    answer: 'Click to get your IP address'
                };
            }
        }
        return null;
    },

    // Settings Detection
    detectSettings: function(query) {
        const patterns = [
            /\b(settings|setting|options|config|configuration|preferences|setup|configure|change settings|open settings|extension settings|sett|opts|prefs)\b/i,
            /\b(dark mode|dark theme|night mode|black theme|toggle dark|enable dark|disable dark|switch theme|theme toggle)\b/i
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                if (/dark|theme|night|black/.test(query.toLowerCase())) {
                    return {
                        type: 'setting',
                        title: 'Toggle Dark Mode',
                        action: 'toggleDarkMode'
                    };
                }
                return {
                    type: 'setting',
                    title: 'Open Extension Settings',
                    action: 'openSettings'
                };
            }
        }
        return null;
    },

    // Coin Flip
    detectCoinFlip: function(query) {
        const patterns = [
            /\b(flip a coin|coin flip|flip coin|coin toss|toss a coin|toss coin|heads or tails|heads tails|random coin|coin|flip|toss|heads tail|ht|h or t)\b/i
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
                return {
                    type: 'coin_flip',
                    title: 'Coin Flip',
                    result: result,
                    answer: result,
                    isRerollable: true
                };
            }
        }
        return null;
    },

    // Dice Rolling
    detectDiceRoll: function(query) {
        const patterns = [
            /\b(roll dice|roll die|roll a die|dice roll|die roll|random dice|dice|die|roll)\b/i,
            /\b(d\d+|(\d+)?\s*sided die)\b/i
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                // Check for specific dice types
                const diceMatch = query.match(/d(\d+)/i);
                const sidesMatch = query.match(/(\d+)\s*sided/i);
                
                let sides = 6; // default
                if (diceMatch) {
                    sides = parseInt(diceMatch[1]);
                } else if (sidesMatch) {
                    sides = parseInt(sidesMatch[1]);
                }
                
                const result = Math.floor(Math.random() * sides) + 1;
                return {
                    type: 'roll_die',
                    title: `Roll D${sides}`,
                    result: result,
                    answer: result.toString(),
                    sides: sides,
                    isRerollable: true
                };
            }
        }
        return null;
    },

    // Password Generation
    detectPasswordGen: function(query) {
        const patterns = [
            /\b(password|generate password|create password|make password|new password|random password|strong password|secure password|safe password|password generator|pass|pwd|passgen|gen password|password gen)\b/i
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                // Check for length specification
                const lengthMatch = query.match(/(\d+)/);
                const length = lengthMatch ? parseInt(lengthMatch[1]) : 16;
                
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
                let password = '';
                for (let i = 0; i < Math.min(Math.max(length, 8), 64); i++) {
                    password += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                
                return {
                    type: 'password',
                    title: `Generate ${length}-character Password`,
                    answer: password,
                    length: length
                };
            }
        }
        return null;
    },

    // QR Code Generation
    detectQRCode: function(query) {
        const patterns = [
            /\b(qr code|qr|generate qr|create qr|make qr|qr generator|qr gen|to qr|as qr|qr for|quick response|barcode)\b/i
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                const text = query.replace(pattern, '').trim() || query;
                return {
                    type: 'qr',
                    title: `Generate QR Code`,
                    text: text,
                    answer: `QR code for: ${text}`
                };
            }
        }
        return null;
    },

    // User Agent Detection
    detectUserAgent: function(query) {
        const patterns = [
            /\b(user agent|my user agent|useragent|my useragent|browser string|browser info|browser agent|ua string|what browser|browser version|my browser|browser details|user string|client string)\b/i
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                return {
                    type: 'user_agent',
                    title: 'Show User Agent',
                    answer: navigator.userAgent
                };
            }
        }
        return null;
    },

    // URL Shortening
    detectURLShorten: function(query) {
        const patterns = [
            /\b(shorten|short|shorten url|short url|make short|url short|tiny url|tinyurl|short link|shorten link|compress url|minify url)\b/i
        ];
        
        const urlPattern = /(https?:\/\/[^\s]+)/i;
        
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                const urlMatch = query.match(urlPattern);
                if (urlMatch) {
                    return {
                        type: 'url_shorten',
                        title: 'Shorten URL',
                        originalUrl: urlMatch[1],
                        answer: 'Click to shorten URL'
                    };
                }
            }
        }
        return null;
    },

    // Time & Clock
    detectTime: function(query) {
        const patterns = [
            /\b(what time is it|time in|what time|current time|time now|whats the time|what's the time|time zone|timezone|clock|time)\b/i
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                const now = new Date();
                const timeString = now.toLocaleTimeString();
                const dateString = now.toLocaleDateString();
                
                return {
                    type: 'time',
                    title: 'Current Time',
                    answer: `${timeString} on ${dateString}`
                };
            }
        }
        return null;
    },

    // Color Detection and Picker
    detectColor: function(query) {
        const patterns = [
            /\b(color|colour|hex|rgb|hsl|color picker|colour picker|color code|colour code)\b/i,
            /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/,
            /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i
        ];
        
        // Check for hex color
        const hexMatch = query.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})/);
        if (hexMatch) {
            let hex = hexMatch[1];
            if (hex.length === 3) {
                hex = hex.split('').map(c => c + c).join('');
            }
            const r = parseInt(hex.substr(0, 2), 16);
            const g = parseInt(hex.substr(2, 2), 16);
            const b = parseInt(hex.substr(4, 2), 16);
            
            return {
                type: 'color',
                title: `Color: #${hex.toUpperCase()}`,
                colorData: { hex: hex.toUpperCase(), r, g, b },
                answer: `RGB(${r}, ${g}, ${b})`
            };
        }
        
        // Check for RGB color
        const rgbMatch = query.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
        if (rgbMatch) {
            const r = parseInt(rgbMatch[1]);
            const g = parseInt(rgbMatch[2]);
            const b = parseInt(rgbMatch[3]);
            const hex = [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
            
            return {
                type: 'color',
                title: `Color: RGB(${r}, ${g}, ${b})`,
                colorData: { hex, r, g, b },
                answer: `#${hex}`
            };
        }
        
        // Check for general color patterns
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                return {
                    type: 'color',
                    title: 'Color Picker',
                    colorData: { hex: 'FF0000', r: 255, g: 0, b: 0 },
                    answer: 'Open color picker'
                };
            }
        }
        
        return null;
    },

    // Base64 Encode/Decode
    detectBase64: function(query) {
        const encodePatterns = [
            /\b(base64 encode|encode to base64|convert to base64|base64|to base64|in base64|as base64|make base64|turn into base64|b64 encode|b64)\b/i
        ];
        
        const decodePatterns = [
            /\b(base64 decode|decode base64|from base64|base64 to text|decode from base64|base64 decrypt|b64 decode|decode b64)\b/i
        ];
        
        // Check for decode patterns first
        for (const pattern of decodePatterns) {
            if (pattern.test(query)) {
                const text = query.replace(pattern, '').trim();
                if (text) {
                    try {
                        const decoded = atob(text);
                        return {
                            type: 'base64_decode',
                            title: 'Base64 Decode',
                            input: text,
                            answer: decoded
                        };
                    } catch (e) {
                        return {
                            type: 'base64_decode',
                            title: 'Base64 Decode',
                            input: text,
                            answer: 'Invalid Base64 string'
                        };
                    }
                }
            }
        }
        
        // Check for encode patterns
        for (const pattern of encodePatterns) {
            if (pattern.test(query)) {
                const text = query.replace(pattern, '').trim();
                if (text) {
                    const encoded = btoa(text);
                    return {
                        type: 'base64_encode',
                        title: 'Base64 Encode',
                        input: text,
                        answer: encoded
                    };
                }
            }
        }
        
        return null;
    },

    // Lorem Ipsum Generator
    detectLoremIpsum: function(query) {
        const patterns = [
            /\b(lorem ipsum|lorem|ipsum|placeholder text|dummy text|filler text|sample text|fake text|lorem generator|latin text|lipsum|placeholder|dummy content|filler content|text placeholder)\b/i
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";
                return {
                    type: 'lorem',
                    title: 'Lorem Ipsum Generator',
                    answer: lorem
                };
            }
        }
        return null;
    },

    // Hash Generation
    detectHashGen: function(query) {
        const patterns = [
            /\b(md5|sha1|sha256|hash|checksum|md5 hash|sha hash|generate hash|create hash|make hash|hash generator|encrypt|digest)\b/i
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                const text = query.replace(pattern, '').trim();
                if (text) {
                    // Simple hash simulation (in real app, use crypto API)
                    const hash = btoa(text).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 32);
                    return {
                        type: 'hash',
                        title: 'Generate Hash (MD5-style)',
                        input: text,
                        answer: hash
                    };
                }
            }
        }
        return null;
    },

    // Random Number Generation
    detectRandomNumber: function(query) {
        const patterns = [
            /\b(random number|random|number|generate number|pick number|choose number)\b/i
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(query)) {
                // Look for range specification
                const rangeMatch = query.match(/(\d+)\s*(?:to|-)?\s*(\d+)/);
                let min = 1, max = 100;
                
                if (rangeMatch) {
                    min = parseInt(rangeMatch[1]);
                    max = parseInt(rangeMatch[2]);
                    if (min > max) [min, max] = [max, min]; // swap if needed
                }
                
                const result = Math.floor(Math.random() * (max - min + 1)) + min;
                return {
                    type: 'random_number',
                    title: `Random Number (${min}-${max})`,
                    result: result,
                    answer: result.toString(),
                    min: min,
                    max: max,
                    isRerollable: true
                };
            }
        }
        return null;
    },

    // Website Navigation Detection
    detectWebsiteNavigation: function(query) {
        // Detect common website patterns
        const patterns = [
            // Direct domain patterns
            /^(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.(?:com|org|net|edu|gov|co\.uk|io|app|dev|ly|me|tech|ai|tv|fm|gg|club|live|online|site|website|blog|shop|store|news|info))\/?.*$/i,
            // Go to website patterns
            /^(?:go to|visit|open|navigate to|goto|website)\s+([a-zA-Z0-9-]+\.(?:com|org|net|edu|gov|co\.uk|io|app|dev|ly|me|tech|ai|tv|fm|gg|club|live|online|site|website|blog|shop|store|news|info))/i,
            // Common short patterns
            /^([a-zA-Z0-9-]+)\.(?:com|org|net|edu|gov|io|app|dev|ly|me|tech|ai|tv|fm|gg)$/i
        ];
        
        for (const pattern of patterns) {
            const match = query.match(pattern);
            if (match) {
                let domain = match[1];
                if (!domain.includes('.')) {
                    // Try common TLDs for single words
                    if (/^[a-zA-Z0-9-]+$/.test(query.trim())) {
                        const commonSites = {
                            'google': 'google.com',
                            'youtube': 'youtube.com',
                            'facebook': 'facebook.com',
                            'twitter': 'twitter.com',
                            'instagram': 'instagram.com',
                            'github': 'github.com',
                            'reddit': 'reddit.com',
                            'stackoverflow': 'stackoverflow.com',
                            'netflix': 'netflix.com',
                            'amazon': 'amazon.com',
                            'apple': 'apple.com',
                            'microsoft': 'microsoft.com',
                            'linkedin': 'linkedin.com',
                            'discord': 'discord.com',
                            'spotify': 'spotify.com',
                            'twitch': 'twitch.tv',
                            'wikipedia': 'wikipedia.org'
                        };
                        domain = commonSites[query.trim().toLowerCase()] || `${query.trim()}.com`;
                    }
                }
                
                const url = domain.startsWith('http') ? domain : `https://${domain}`;
                const displayDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '');
                
                return {
                    type: 'navigation',
                    title: `Go to ${displayDomain}`,
                    url: url,
                    domain: displayDomain,
                    favicon: `https://www.google.com/s2/favicons?domain=${displayDomain}&sz=32`
                };
            }
        }
        return null;
    },

    // Unit Converter
    detectUnitConversion: function(query) {
        const conversionPattern = /(\d+(?:\.\d+)?)\s*(kg|lb|pounds?|kilograms?|celsius|fahrenheit|c|f|km|miles?|mi|meters?|m|feet|ft|inches?|in)\s+(?:to|in)\s+(kg|lb|pounds?|kilograms?|celsius|fahrenheit|c|f|km|miles?|mi|meters?|m|feet|ft|inches?|in)/i;
        
        const match = query.match(conversionPattern);
        if (match) {
            const [, value, fromUnit, toUnit] = match;
            const num = parseFloat(value);
            
            // Simple conversion logic (add more as needed)
            const conversions = {
                'kg_lb': (kg) => kg * 2.20462,
                'lb_kg': (lb) => lb / 2.20462,
                'c_f': (c) => (c * 9/5) + 32,
                'f_c': (f) => (f - 32) * 5/9,
                'km_mi': (km) => km * 0.621371,
                'mi_km': (mi) => mi / 0.621371,
                'm_ft': (m) => m * 3.28084,
                'ft_m': (ft) => ft / 3.28084
            };
            
            // Normalize units
            const normalizeUnit = (unit) => {
                unit = unit.toLowerCase();
                if (['pounds', 'pound', 'lb'].includes(unit)) return 'lb';
                if (['kilograms', 'kilogram', 'kg'].includes(unit)) return 'kg';
                if (['celsius', 'c'].includes(unit)) return 'c';
                if (['fahrenheit', 'f'].includes(unit)) return 'f';
                if (['kilometers', 'kilometer', 'km'].includes(unit)) return 'km';
                if (['miles', 'mile', 'mi'].includes(unit)) return 'mi';
                if (['meters', 'meter', 'm'].includes(unit)) return 'm';
                if (['feet', 'foot', 'ft'].includes(unit)) return 'ft';
                if (['inches', 'inch', 'in'].includes(unit)) return 'in';
                return unit;
            };
            
            const from = normalizeUnit(fromUnit);
            const to = normalizeUnit(toUnit);
            const conversionKey = `${from}_${to}`;
            
            if (conversions[conversionKey]) {
                const result = conversions[conversionKey](num);
                return {
                    type: 'converter',
                    title: `Unit Conversion`,
                    input: `${value} ${fromUnit}`,
                    answer: `${result.toFixed(2)} ${toUnit}`
                };
            }
        }
        
        return null;
    }
};

const unpinnedIconSVG = `<svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="2"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-pinned"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M9 4v6l-2 4v2h10v-2l-2 -4v-6" /><path d="M12 16l0 5" /><path d="M8 4l8 0" /></svg>`;
const pinnedIconSVG = `<svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="currentColor"  class="icon icon-tabler icons-tabler-filled icon-tabler-pinned"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M16 3a1 1 0 0 1 .117 1.993l-.117 .007v4.764l1.894 3.789a1 1 0 0 1 .1 .331l.006 .116v2a1 1 0 0 1 -.883 .993l-.117 .007h-4v4a1 1 0 0 1 -1.993 .117l-.007 -.117v-4h-4a1 1 0 0 1 -.993 -.883l-.007 -.117v-2a1 1 0 0 1 .06 -.34l.046 -.107l1.894 -3.791v-4.762a1 1 0 0 1 -.117 -1.993l.117 -.007h8z" /></svg>`;
const historyIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`;

const aiIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-robot" viewBox="0 0 16 16"><path d="M2.5 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM0 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2.5a2 2 0 0 1-2 2h-1.5V13a.5.5 0 0 1-1 0v-1H4v1a.5.5 0 0 1-1 0v-1H1.5a2 2 0 0 1-2-2V8zm2-1a1 1 0 0 0-1 1v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H2zM8.5 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12.5 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg>`;
const sparkleIcon = `<svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="2"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-sparkles"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z" /></svg>`;
const searchIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#888" viewBox="0 0 16 16"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>`;
const googleIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 262"><path fill="#4285F4" d="M255.95 133.534c0-11.08-.978-21.712-2.792-32H130.5v60.56h70.34c-3.003 16.304-12.15 30.14-25.906 39.44l42.017 32.597c24.41-22.52 38.5-55.74 38.5-100.6z"/><path fill="#34A853" d="M130.5 262c34.83 0 64.113-11.505 85.484-31.194l-42.017-32.597c-11.652 7.81-26.576 12.444-43.467 12.444-33.47 0-61.853-22.563-72.051-52.976H14.29v33.124A130.996 130.996 0 00130.5 262z"/><path fill="#FBBC05" d="M58.449 157.677a78.83 78.83 0 010-50.354V74.2H14.29a131.002 131.002 0 000 113.6l44.16-30.123z"/><path fill="#EA4335" d="M130.5 51.58c18.892 0 36.014 6.503 49.399 19.278l37.002-37.002C194.498 12.224 165.314 0 130.5 0 80.58 0 37.82 30.116 14.29 74.2l44.16 33.123c10.198-30.412 38.58-52.947 72.05-52.947z"/></svg>`;
const calcIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M0 1.5A.5.5 0 01.5 1h15a.5.5 0 01.5.5V15a1 1 0 01-1 1H1a1 1 0 01-1-1V1.5zM1 2v13h14V2H1z"/><path d="M2 4h12v2H2V4zm2 3h2v2H4V7zm3 0h2v2H7V7zm3 0h2v2h-2V7zM4 10h2v2H4v-2zm3 0h2v2H7v-2zm3 0h2v2h-2v-2z"/></svg>`;

// AI Provider icons
const brainIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5a2.5 2.5 0 0 0-4.96-.46 2.5 2.5 0 0 0-1.98 3 2.5 2.5 0 0 0-1.32 4.24 3 3 0 0 0 .34 5.58 2.5 2.5 0 0 0 2.96 3.08A2.5 2.5 0 0 0 9.5 22v-1.5a2.5 2.5 0 0 0-1.5-2.29 2.5 2.5 0 0 1-1.05-4.19 2.5 2.5 0 0 1 2.05-2.17A2.5 2.5 0 0 1 12 9.5Z"/><path d="M12 4.5a2.5 2.5 0 0 1 4.96-.46 2.5 2.5 0 0 1 1.98 3 2.5 2.5 0 0 1 1.32 4.24 3 3 0 0 1-.34 5.58 2.5 2.5 0 0 1-2.96 3.08A2.5 2.5 0 0 1 14.5 22v-1.5a2.5 2.5 0 0 1 1.5-2.29 2.5 2.5 0 0 0 1.05-4.19 2.5 2.5 0 0 0-2.05-2.17A2.5 2.5 0 0 0 12 9.5Z"/></svg>`;
const lightningIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`;
// Bootstrap Icons – "clipboard"
const copyIcon = `<svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="2"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-copy"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z" /><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" /></svg>`;
const convertIcon = `<svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="currentColor"  class="icon icon-tabler icons-tabler-filled icon-tabler-transform"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M18 14a4 4 0 1 1 -3.995 4.2l-.005 -.2l.005 -.2a4 4 0 0 1 3.995 -3.8z" /><path d="M16.707 2.293a1 1 0 0 1 .083 1.32l-.083 .094l-1.293 1.293h3.586a3 3 0 0 1 2.995 2.824l.005 .176v3a1 1 0 0 1 -1.993 .117l-.007 -.117v-3a1 1 0 0 0 -.883 -.993l-.117 -.007h-3.585l1.292 1.293a1 1 0 0 1 -1.32 1.497l-.094 -.083l-3 -3a.98 .98 0 0 1 -.28 -.872l.036 -.146l.04 -.104c.058 -.126 .14 -.24 .245 -.334l2.959 -2.958a1 1 0 0 1 1.414 0z" /><path d="M3 12a1 1 0 0 1 .993 .883l.007 .117v3a1 1 0 0 0 .883 .993l.117 .007h3.585l-1.292 -1.293a1 1 0 0 1 -.083 -1.32l.083 -.094a1 1 0 0 1 1.32 -.083l.094 .083l3 3a.98 .98 0 0 1 .28 .872l-.036 .146l-.04 .104a1.02 1.02 0 0 1 -.245 .334l-2.959 2.958a1 1 0 0 1 -1.497 -1.32l.083 -.094l1.291 -1.293h-3.584a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-3a1 1 0 0 1 1 -1z" /><path d="M6 2a4 4 0 1 1 -3.995 4.2l-.005 -.2l.005 -.2a4 4 0 0 1 3.995 -3.8z" /></svg>`;

// Additional icons for new search types
const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Z"/><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4Z"/></svg>`;
const timeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/></svg>`;
const colorIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M12.433 10.07C14.133 10.585 16 11.15 16 8a8 8 0 1 0-8 8c1.996 0 1.826-1.504 1.649-3.08-.124-1.101-.252-2.237.351-2.92.465-.527 1.42-.237 2.433.07zM8 5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4.5 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM5 6.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm.5 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>`;
const qrIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M2 2h2v2H2V2zm1 1v0zm2 0h2v2H5V3zm3-1h2v2H8V2zm3 1h2v2h-2V3zM2 5h2v2H2V5zm3 0h2v2H5V5zm6 0h2v2h-2V5zM2 8h2v2H2V8zm3 0h2v2H5V8zm3 0h2v2H8V8zm3 0h2v2h-2V8zM2 11h2v2H2v-2zm3 0h2v2H5v-2zm3 0h2v2H8v-2zm3 0h2v2h-2v-2z"/></svg>`;
const passwordIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/></svg>`;
const hashIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8.39 12.648a1.32 1.32 0 0 0-.015.18c0 .305.21.508.5.508.266 0 .492-.172.555-.477l.554-2.703h1.204c.421 0 .617-.234.617-.547 0-.312-.188-.53-.617-.53h-.985l.516-2.524h1.204c.421 0 .617-.234.617-.547 0-.312-.188-.53-.617-.53h-.985l.516-2.492c.05-.316-.133-.539-.477-.539-.312 0-.539.172-.586.445l-.551 2.586h-2.078l.516-2.492c.05-.316-.133-.539-.477-.539-.312 0-.539.172-.586.445l-.551 2.586H2.78c-.421 0-.617.234-.617.547 0 .312.188.53.617.53h.985l-.516 2.524H2.045c-.421 0-.617.234-.617.547 0 .312.188.53.617.53h.985l-.516 2.492c-.05.316.133.539.477.539.312 0 .539-.172.586-.445l.551-2.586h2.078l-.516 2.492zm-1.188-4.016h2.078l-.516 2.524H6.686l.516-2.524z"/></svg>`;
const linkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M6.354 5.5H4a3 3 0 0 0 0 6h3a3 3 0 0 0 2.83-4H9c-.086 0-.17.01-.25.031A2 2 0 0 1 7 10.5H4a2 2 0 1 1 0-4h1.535c.218-.376.495-.714.82-1z"/><path d="M9 5.5a3 3 0 0 0-2.83 4h1.098A2 2 0 0 1 9 6.5h3a2 2 0 1 1 0 4h-1.535a4.02 4.02 0 0 1-.82 1H12a3 3 0 1 0 0-6H9z"/></svg>`;
const ipIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a6.958 6.958 0 0 0-.656 2.5h2.49zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5H4.847zM8.5 5v2.5h2.99a12.495 12.495 0 0 0-.337-2.5H8.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5H4.51zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5H8.5zM5.145 12c.138.386.295.744.468 1.068.552 1.035 1.218 1.65 1.887 1.855V12H5.145zm.182 2.472a6.696 6.696 0 0 1-.597-.933A9.268 9.268 0 0 1 4.09 12H2.255a7.024 7.024 0 0 0 3.072 2.472zM3.82 11a13.652 13.652 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5H3.82zm6.853 3.472A7.024 7.024 0 0 0 13.745 12H11.91a9.27 9.27 0 0 1-.64 1.539 6.688 6.688 0 0 1-.597.933zM8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855.173-.324.33-.682.468-1.068H8.5zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.65 13.65 0 0 1-.312 2.5zm2.802-3.5a6.959 6.959 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5h2.49zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7.024 7.024 0 0 0-3.072-2.472c.218.284.418.598.597.933zM10.855 4a7.966 7.966 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4h2.355z"/></svg>`;
const textIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5 2V1a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3zM4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06zm6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528zM8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5z"/></svg>`;
const base64Icon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.478 1.647a.5.5 0 1 0-.956-.294l-4 13a.5.5 0 0 0 .956.294l4-13zM4.854 4.146a.5.5 0 0 1 0 .708L1.707 8l3.147 3.146a.5.5 0 0 1-.708.708l-3.5-3.5a.5.5 0 0 1 0-.708l3.5-3.5a.5.5 0 0 1 .708 0zm6.292 0a.5.5 0 0 0 0 .708L14.293 8l-3.147 3.146a.5.5 0 0 0 .708.708l3.5-3.5a.5.5 0 0 0 0-.708l-3.5-3.5a.5.5 0 0 0-.708 0z"/></svg>`;
const settingsIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.901 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319z"/></svg>`;
const coinIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14zm0 1A8 8 0 1 1 8 0a8 8 0 0 1 0 16z"/><path d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zm0 .5A6 6 0 1 0 8 2a6 6 0 0 0 0 12z"/></svg>`;
const dieIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M13.5 1a1.5 1.5 0 0 0-1.5 1.5v11a1.5 1.5 0 0 0 1.5 1.5h-11A1.5 1.5 0 0 0 1 13.5v-11A1.5 1.5 0 0 0 2.5 1h11zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/><path d="M5.5 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm8 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm-8 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm8 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/></svg>`;
const randomIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M.5 1a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1H1.732l4.096 4.096a.5.5 0 0 1 0 .708L1.732 10.5H4a.5.5 0 0 1 0 1H1a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 1 0v1.268l3.096-3.096L1.5 2.732V4a.5.5 0 0 1-1 0V1zm15 14a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1 0-1h2.268l-4.096-4.096a.5.5 0 0 1 0-.708L14.268 5.5H12a.5.5 0 0 1 0-1h3a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V6.732l-3.096 3.096L14.5 13.268V12a.5.5 0 0 1 1 0v3z"/></svg>`;
const globeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-globe" viewBox="0 0 16 16"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a6.958 6.958 0 0 0-.656 2.5h2.49zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5H4.847zM8.5 5v2.5h2.99a12.495 12.495 0 0 0-.337-2.5H8.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5H4.51zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5H8.5zM5.145 12c.138.386.295.744.468 1.068.552 1.035 1.218 1.65 1.887 1.855V12H5.145zm.182 2.472a6.696 6.696 0 0 1-.597-.933A9.268 9.268 0 0 1 4.09 12H2.255a7.024 7.024 0 0 0 3.072 2.472zM3.82 11a13.652 13.652 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5H3.82zm6.853 3.472A7.024 7.024 0 0 0 13.745 12H11.91a9.27 9.27 0 0 1-.64 1.539 6.688 6.688 0 0 1-.597.933zM8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855.173-.324.33-.682.468-1.068H8.5zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.65 13.65 0 0 1-.312 2.5zm2.802-3.5a6.959 6.959 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5h2.49zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7.024 7.024 0 0 0-3.072-2.472c.218.284.418.598.597.933zM10.855 4a7.966 7.966 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4h2.355z"/></svg>`;

const createIcon = (svg) => {
    const div = document.createElement('div');
    div.className = 'favicon';
    div.innerHTML = svg;
    return div;
};

function updateSelection() {
    document.querySelectorAll('.result-item').forEach((item, index) => {
        if (index === selectedIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function updateRestoreChatButtonVisibility() {
    if (chatWasHidden && chatHistory && chatHistory.children.length > 0) {
        restoreChatButton.style.display = 'flex';
    } else {
        restoreChatButton.style.display = 'none';
    }
}

function updatePinButton() {
    pinButton.classList.toggle('pinned', isPinned);
    pinButton.innerHTML = isPinned ? pinnedIconSVG : unpinnedIconSVG;
    pinButton.title = isPinned ? 'Unpin window' : 'Pin window';
}

function togglePin() {
    isPinned = !isPinned;
    updatePinButton();
    window.parent.postMessage({ action: "togglePin", pinned: isPinned }, "*");
}

// Chat history management functions
async function loadChatSessions() {
    try {
        // Browser API compatibility
        const storageAPI = (typeof browser !== 'undefined' && browser.storage) ? browser.storage : 
                          (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage : null;
        
        if (!storageAPI) {
            console.warn('Storage API not available, using localStorage fallback');
            const stored = localStorage.getItem('mooncow_chatSessions');
            if (stored) {
                const sessions = new Map(JSON.parse(stored));
                chatSessions = sessions;
            }
            return;
        }

        const result = await storageAPI.local.get(['chatSessions']);
        if (result.chatSessions) {
            const sessions = new Map(result.chatSessions);
            chatSessions = sessions;
            console.log('Loaded', chatSessions.size, 'chat sessions from storage');
        }
    } catch (error) {
        console.error('Failed to load chat sessions:', error);
        // Fallback to localStorage
        try {
            const stored = localStorage.getItem('mooncow_chatSessions');
            if (stored) {
                const sessions = new Map(JSON.parse(stored));
                chatSessions = sessions;
                console.log('Loaded', chatSessions.size, 'chat sessions from localStorage fallback');
            }
        } catch (fallbackError) {
            console.error('localStorage fallback also failed:', fallbackError);
        }
    }
}

async function saveChatSessions() {
    try {
        // Browser API compatibility
        const storageAPI = (typeof browser !== 'undefined' && browser.storage) ? browser.storage : 
                          (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage : null;
        
        if (!storageAPI) {
            console.warn('Storage API not available, using localStorage fallback');
            localStorage.setItem('mooncow_chatSessions', JSON.stringify(Array.from(chatSessions.entries())));
            return;
        }

        await storageAPI.local.set({
            chatSessions: Array.from(chatSessions.entries())
        });
        console.log('Saved', chatSessions.size, 'chat sessions to storage');
    } catch (error) {
        console.error('Failed to save chat sessions:', error);
        // Fallback to localStorage
        try {
            localStorage.setItem('mooncow_chatSessions', JSON.stringify(Array.from(chatSessions.entries())));
            console.log('Saved', chatSessions.size, 'chat sessions to localStorage fallback');
        } catch (fallbackError) {
            console.error('localStorage fallback also failed:', fallbackError);
        }
    }
}

function createChatSession(initialQuery) {
    const chatId = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9);
    const session = {
        id: chatId,
        timestamp: Date.now(),
        title: initialQuery.length > 30 ? initialQuery.substring(0, 30) + '...' : initialQuery,
        messages: [],
        conversation: [],
        scrollPosition: 0,
        followupValue: '',
        isExpanded: false
    };
    
    chatSessions.set(chatId, session);
    saveChatSessions();
    return chatId;
}

function updateCurrentChatSession() {
    if (!currentChatId || !chatSessions.has(currentChatId)) return;
    
    const session = chatSessions.get(currentChatId);
    
    // Save current state
    if (chatHistory) {
        session.scrollPosition = chatHistory.scrollTop;
        session.messages = Array.from(chatHistory.children).map(el => ({
            content: el.textContent,
            type: el.classList.contains('user-message') ? 'user' : 'ai',
            html: el.innerHTML
        }));
    }
    
    if (followupInput) {
        session.followupValue = followupInput.value;
    }
    
    session.isExpanded = chatTileContainer.classList.contains('expanded');
    
    chatSessions.set(currentChatId, session);
    saveChatSessions();
}

function switchToChatSession(chatId) {
    // Save current session state first
    updateCurrentChatSession();
    
    const session = chatSessions.get(chatId);
    if (!session) return;
    
    // Clear any existing chat UI completely before switching
    if (chatTileContainer) {
        chatTileContainer.innerHTML = '';
    }
    
    currentChatId = chatId;
    
    // Always recreate the chat UI to ensure clean state
    if (!chatTileContainer || chatTileContainer.children.length === 0) {
        // Create basic chat UI structure
        isChatActive = true;
        chatWasHidden = false;
        document.body.classList.add('chat-active');
        window.parent.postMessage({ action: "expandForChat" }, "*");
        
        chatTileContainer.innerHTML = '';
        chatTileContainer.style.display = 'flex';
        chatTileContainer.style.height = '260px';
        chatTileContainer.style.overflow = 'visible';

        const closeButton = document.createElement('button');
        closeButton.innerHTML = '×';
        closeButton.className = 'chat-close-button';
        closeButton.onclick = closeChatTile;
        chatTileContainer.appendChild(closeButton);

        const expandButton = document.createElement('button');
        expandButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
        </svg>`;
        expandButton.className = 'chat-expand-button';
        expandButton.title = 'Expand chat';
        expandButton.onclick = () => {
            const isExpanded = chatTileContainer.classList.contains('expanded');
            if (isExpanded) {
                chatTileContainer.classList.remove('expanded');
                chatTileContainer.style.height = '260px';
                expandButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>`;
                expandButton.title = 'Expand chat';
            } else {
                chatTileContainer.classList.add('expanded');
                chatTileContainer.style.height = '450px';
                expandButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>`;
                expandButton.title = 'Shrink chat';
            }
            updateCurrentChatSession();
        };
        chatTileContainer.appendChild(expandButton);

        chatHistory = document.createElement('div');
        chatHistory.className = 'chat-history';
        chatHistory.style.flexGrow = '1';
        chatTileContainer.appendChild(chatHistory);

        const followupContainer = document.createElement('div');
        followupContainer.className = 'followup-container';
        followupInput = document.createElement('input');
        followupInput.type = 'text';
        followupInput.placeholder = 'Ask a follow up...';

        const clearButton = document.createElement('button');
        clearButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
        clearButton.className = 'clear-chat-button';
        clearButton.title = 'Clear chat';
        clearButton.onclick = () => {
            clearChatHistory();
        };

        const sendButton = document.createElement('button');
        sendButton.textContent = 'Send';

        const handleFollowUp = () => {
            if (!followupInput) return;
            const followupQuery = followupInput.value;
            if (followupQuery.trim()) {
                // Get current session conversation
                const currentSession = chatSessions.get(currentChatId);
                if (currentSession) {
                    let conversation = [...currentSession.conversation];
                    conversation.push({ role: 'user', content: followupQuery });
                    currentSession.conversation = [...conversation];
                    saveChatSessions();
                    
                    appendMessage(followupQuery, 'user', chatHistory);
                    const followupThinkingMessage = aiProvider === 'google' ? 'Analyzing with smart AI (this may take a moment)...' : 'Thinking...';
                    const thinkingFollowupEl = appendMessage(followupThinkingMessage, 'ai', chatHistory, true);
                    followupInput.value = '';
                    chatHistory.scrollTop = chatHistory.scrollHeight;

                    // Start streaming tokens instead of waiting for full response
                    startStreaming(aiProvider, conversation, thinkingFollowupEl);
                }
            }
        };

        sendButton.addEventListener('click', handleFollowUp);
        followupInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleFollowUp();
            setTimeout(() => updateCurrentChatSession(), 100);
        });

                    followupContainer.appendChild(followupInput);
        
        // Create AI provider toggle directly in chat
        const aiToggle = document.createElement('div');
        aiToggle.id = 'ai-provider-toggle';
        aiToggle.className = 'ai-provider-toggle';
        
        const lightningBtn = document.createElement('button');
        lightningBtn.className = 'ai-provider-btn lightning-btn' + (aiProvider === 'cerebras' ? ' active' : '');
        lightningBtn.title = 'Fast AI (Cerebras)';
        lightningBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>';
        lightningBtn.onclick = () => switchAIProvider('cerebras');
        
        const brainBtn = document.createElement('button');
        brainBtn.className = 'ai-provider-btn brain-btn' + (aiProvider === 'google' ? ' active' : '');
        brainBtn.title = 'Smart AI (Google)';
        brainBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5a2.5 2.5 0 0 0-4.96-.46 2.5 2.5 0 0 0-1.98 3 2.5 2.5 0 0 0-1.32 4.24 3 3 0 0 0 .34 5.58 2.5 2.5 0 0 0 2.96 3.08A2.5 2.5 0 0 0 9.5 22v-1.5a2.5 2.5 0 0 0-1.5-2.29 2.5 2.5 0 0 1-1.05-4.19 2.5 2.5 0 0 1 2.05-2.17A2.5 2.5 0 0 1 12 9.5Z"></path><path d="M12 4.5a2.5 2.5 0 0 1 4.96-.46 2.5 2.5 0 0 1 1.98 3 2.5 2.5 0 0 1 1.32 4.24 3 3 0 0 1-.34 5.58 2.5 2.5 0 0 1-2.96 3.08A2.5 2.5 0 0 1 14.5 22v-1.5a2.5 2.5 0 0 1 1.5-2.29 2.5 2.5 0 0 0 1.05-4.19 2.5 2.5 0 0 0-2.05-2.17A2.5 2.5 0 0 0 12 9.5Z"></path></svg>';
        brainBtn.onclick = () => switchAIProvider('google');
        
        aiToggle.appendChild(lightningBtn);
        aiToggle.appendChild(brainBtn);
        followupContainer.appendChild(aiToggle);
        
        followupContainer.appendChild(clearButton);
        followupContainer.appendChild(sendButton);
        chatTileContainer.appendChild(followupContainer);
    }
    
    // Restore messages
    if (chatHistory && session.messages.length > 0) {
        chatHistory.innerHTML = '';
        session.messages.forEach(msg => {
            const messageEl = document.createElement('div');
            messageEl.className = `chat-message ${msg.type}-message`;
            messageEl.innerHTML = msg.html;
            
            // Add click handlers for Ask Mooncow hyperlinks
            messageEl.querySelectorAll('.ask-mooncow-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const question = decodeURIComponent(link.dataset.question).replace(/\+/g, ' ');
                    if (followupInput) {
                        followupInput.value = question;
                        // Auto-send the message
                        const sendEvent = new Event('keydown');
                        sendEvent.key = 'Enter';
                        followupInput.dispatchEvent(sendEvent);
                    }
                });
            });
            
            chatHistory.appendChild(messageEl);
        });
        
        // Restore scroll position
        setTimeout(() => {
            chatHistory.scrollTop = session.scrollPosition;
        }, 50);
    }
    
    // Restore follow-up input value
    if (followupInput && session.followupValue) {
        followupInput.value = session.followupValue;
    }
    
    // Restore expanded state
    if (session.isExpanded) {
        chatTileContainer.classList.add('expanded');
        chatTileContainer.style.height = '450px';
        const expandButton = chatTileContainer.querySelector('.chat-expand-button');
        if (expandButton) {
            expandButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>`;
            expandButton.title = 'Shrink chat';
        }
    }
    
    updateRestoreChatButtonVisibility();
    focusFollowupInput();
}

function createHistoryButton() {
    const historyButton = document.createElement('button');
    historyButton.id = 'history-button';
    historyButton.className = 'history-button';
    historyButton.innerHTML = historyIconSVG;
    historyButton.title = 'Chat History';
    historyButton.onclick = toggleChatHistory;
    
    // Insert after pin button
    pinButton.parentNode.insertBefore(historyButton, pinButton.nextSibling);
    
    return historyButton;
}

function initializeAIProviderToggle() {
    const lightningBtn = document.querySelector('.ai-provider-btn.lightning-btn');
    const brainBtn = document.querySelector('.ai-provider-btn.brain-btn');
    
    if (lightningBtn) {
        lightningBtn.onclick = () => switchAIProvider('cerebras');
    }
    
    if (brainBtn) {
        brainBtn.onclick = () => switchAIProvider('google');
    }
    
    updateAIProviderToggle();
}



function switchAIProvider(provider) {
    aiProvider = provider;
    updateAIProviderToggle();
    
    // Save preference
    try {
        const storageAPI = (typeof browser !== 'undefined' && browser.storage) ? browser.storage : 
                          (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage : null;
        if (storageAPI) {
            storageAPI.local.set({ aiProvider: provider });
        } else {
            localStorage.setItem('mooncow_aiProvider', provider);
        }
    } catch (error) {
        console.warn('Failed to save AI provider preference:', error);
    }
}

function updateAIProviderToggle() {
    const lightningBtn = document.querySelector('.ai-provider-btn.lightning-btn');
    const brainBtn = document.querySelector('.ai-provider-btn.brain-btn');
    
    if (!lightningBtn || !brainBtn) return;
    
    if (aiProvider === 'cerebras') {
        lightningBtn.classList.add('active');
        brainBtn.classList.remove('active');
    } else {
        lightningBtn.classList.remove('active');
        brainBtn.classList.add('active');
    }
}

async function loadAIProviderPreference() {
    try {
        const storageAPI = (typeof browser !== 'undefined' && browser.storage) ? browser.storage : 
                          (typeof chrome !== 'undefined' && chrome.storage) ? chrome.storage : null;
        
        if (storageAPI) {
            const result = await storageAPI.local.get(['aiProvider']);
            if (result.aiProvider) {
                aiProvider = result.aiProvider;
            }
        } else {
            const stored = localStorage.getItem('mooncow_aiProvider');
            if (stored) {
                aiProvider = stored;
            }
        }
    } catch (error) {
        console.warn('Failed to load AI provider preference:', error);
    }
    
    // Update the UI to reflect the loaded preference
    updateAIProviderToggle();
}

function toggleChatHistory() {
    if (chatHistoryDropdown && chatHistoryDropdown.style.display === 'block') {
        hideChatHistory();
    } else {
        showChatHistory();
    }
}

function showChatHistory() {
    if (!chatHistoryDropdown) {
        createChatHistoryDropdown();
    }
    
    updateChatHistoryList();
    // Position as a fixed overlay anchored to the history button
    const historyButton = document.getElementById('history-button');
    chatHistoryDropdown.style.display = 'block';
    if (historyButton) {
        const rect = historyButton.getBoundingClientRect();
        const width = 300; // match inline width
        const vpWidth = window.innerWidth || document.documentElement.clientWidth;
        const left = Math.max(8, Math.min(rect.right - width, vpWidth - width - 8));
        chatHistoryDropdown.style.top = `${Math.round(rect.bottom + 6)}px`;
        chatHistoryDropdown.style.left = `${Math.round(left)}px`;
    }
}

function hideChatHistory() {
    if (chatHistoryDropdown) {
        chatHistoryDropdown.style.display = 'none';
    }
}

function createChatHistoryDropdown() {
    chatHistoryDropdown = document.createElement('div');
    chatHistoryDropdown.className = 'chat-history-dropdown';
    chatHistoryDropdown.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 300px;
        max-height: 400px;
        background: #111827;
        border: 1px solid #374151;
        border-radius: 8px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.65);
        z-index: 2147483647;
        display: none;
        overflow-y: auto;
    `;
    
    document.querySelector('.header-buttons').appendChild(chatHistoryDropdown);
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!chatHistoryDropdown.contains(e.target) && !e.target.closest('#history-button')) {
            hideChatHistory();
        }
    });
}

function updateChatHistoryList() {
    if (!chatHistoryDropdown) return;
    
    const sessions = Array.from(chatSessions.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 20); // Show last 20 chats
    
    // Update history button visual indicator
    const historyButton = document.getElementById('history-button');
    if (historyButton) {
        if (sessions.length > 0) {
            historyButton.classList.add('has-chats');
        } else {
            historyButton.classList.remove('has-chats');
        }
    }
    
    chatHistoryDropdown.innerHTML = '';
    
    // Create header
    const header = document.createElement('div');
    header.className = 'chat-history-header';
    header.innerHTML = `
        Chat History
        <button class="chat-history-clear-btn">Clear All</button>
    `;
    
    chatHistoryDropdown.appendChild(header);
    
    // Create "New Chat" button
    const newChatButton = document.createElement('button');
    newChatButton.className = 'chat-new-button';
    newChatButton.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 5v14M5 12h14"/>
        </svg>
        Start New Chat
    `;
    
    newChatButton.addEventListener('click', () => {
        hideChatHistory();
        // Close any existing chat
        if (isChatActive) {
            closeChatTile();
        }
        // Clear current chat ID to start fresh
        currentChatId = null;
        // Focus the search input for new query
        setTimeout(() => {
            searchInput.focus();
        }, 100);
    });
    
    chatHistoryDropdown.appendChild(newChatButton);
    
    if (sessions.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'chat-history-empty';
        emptyDiv.textContent = 'No chat history yet';
        chatHistoryDropdown.appendChild(emptyDiv);
        return;
    }
    
    // Create list container
    const listContainer = document.createElement('div');
    listContainer.className = 'chat-history-list';
    
    sessions.forEach(session => {
        const item = document.createElement('div');
        item.className = 'chat-history-item';
        if (session.id === currentChatId) {
            item.classList.add('active');
        }
        
        const date = new Date(session.timestamp);
        const timeStr = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        }).format(date);
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'chat-history-content';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'chat-history-title';
        titleDiv.textContent = session.title;
        
        const timeDiv = document.createElement('div');
        timeDiv.className = 'chat-history-time';
        timeDiv.textContent = timeStr;
        
        contentDiv.appendChild(titleDiv);
        contentDiv.appendChild(timeDiv);
        
        const deleteButton = document.createElement('button');
        deleteButton.className = 'chat-history-delete';
        deleteButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
        </svg>`;
        deleteButton.title = 'Delete chat';
        
        // Event listeners
        deleteButton.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Delete chat: "${session.title}"?`)) {
                chatSessions.delete(session.id);
                if (currentChatId === session.id) {
                    currentChatId = null;
                    if (isChatActive) {
                        closeChatTile();
                    }
                }
                saveChatSessions();
                updateChatHistoryList();
            }
        });
        
        contentDiv.addEventListener('click', () => {
            switchToChatSession(session.id);
            hideChatHistory();
        });
        
        item.appendChild(contentDiv);
        item.appendChild(deleteButton);
        listContainer.appendChild(item);
    });
    
    chatHistoryDropdown.appendChild(listContainer);
    
    // Add clear all functionality
    const clearAllBtn = header.querySelector('.chat-history-clear-btn');
    clearAllBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all chat history?')) {
            clearAllChatHistory();
            hideChatHistory();
        }
    });
}

function clearAllChatHistory() {
    chatSessions.clear();
    currentChatId = null;
    saveChatSessions();
    
    // Close current chat if open
    if (isChatActive) {
        closeChatTile();
    }
    
    // Reset chat state
    chatHistory = null;
    followupInput = null;
    chatWasHidden = false;
    updateRestoreChatButtonVisibility();
}

function displayResults(tabResults, query, suggestions = [], specialOverrideResults = null, precomputedResults = null) {
    resultsDiv.innerHTML = '';
    selectedIndex = -1;

    if (precomputedResults) {
        currentResults = precomputedResults;
    } else if (specialOverrideResults) {
        currentResults = specialOverrideResults;
    } else {
        let specialResults = [];
        if (query && query.trim().length > 0) {
            const detectors = window.searchDetectors;
            if (detectors) {
                specialResults = Object.values(detectors)
                    .map(detector => {
                        try {
                            return detector(query);
                        } catch (e) {
                            console.warn('Detector error:', e);
                            return null;
                        }
                    })
                    .filter(result => result !== null && result.type !== 'show_app_suggestions'); // Exclude our special type from normal flow
            }

            // Always add AI and Google search as fallbacks
            specialResults.push({ type: 'ai', query: query, title: `Ask AI: "${query}"` });
            specialResults.push({ type: 'google', query: query, text: query, title: `Search Google for "${query}"`});
        }
        
        let rankableCandidates = [...specialResults];
        rankableCandidates.push(...tabResults.map(tab => ({ ...tab, type: 'tab', text: tab.title })));
        rankableCandidates.push(...suggestions.map((s, index) => {
            const answerMatch = s.match(/^\s*=\s*(.+)$/); // Match suggestions starting with "="
            if (answerMatch) {
                return {
                    type: 'calculator',
                    text: s,
                    title: answerMatch[1].trim(), // The title is just the answer
                    answer: answerMatch[1].trim(),
                    isCopyResult: true, // Special flag for our new result type
                    remoteRank: index
                };
            }
            return { type: 'suggestion', text: s, title: s, remoteRank: index };
        }));
        
        currentResults = window.rankResults(rankableCandidates, query);
    }

    // Ranking and ordering are now handled exclusively by ranking.js (LunarRank).

    resultsDiv.innerHTML = ''; // Clear again just in case
    currentResults.forEach(async (result, i) => {
        const resultItem = document.createElement('div');
        resultItem.dataset.type = result.type; // tag for later reordering
        
        // --- Set Classes ---
        if (result.type === 'engine_suggestion') {
            resultItem.className = 'result-item search-engine-item';
        } else if (result.type === 'app_search') {
            resultItem.className = 'result-item app-search-result';
        } else {
            resultItem.className = 'result-item';
        }

        // --- Render Content ---
        if (result.type === 'engine_suggestion') {
            const iconDiv = document.createElement('div');
            iconDiv.className = 'engine-icon';
            if (result.icon) {
                iconDiv.innerHTML = result.icon;
            } else {
                const favicon = document.createElement('img');
                favicon.src = `https://www.google.com/s2/favicons?domain=${result.domain}&sz=32`;
                iconDiv.appendChild(favicon);
            }
            const textDiv = document.createElement('div');
            textDiv.className = 'engine-text';
            textDiv.textContent = result.title;
            resultItem.appendChild(iconDiv);
            resultItem.appendChild(textDiv);
        } else if (result.type === 'app_search') {
            const searchIconDiv = document.createElement('div');
            searchIconDiv.className = 'search-result-icon';
            searchIconDiv.innerHTML = searchIcon;
            
            const textContainer = document.createElement('div');
            textContainer.className = 'search-result-content';
            
            const queryPill = document.createElement('span');
            queryPill.className = 'search-query-pill';
            queryPill.setAttribute('data-service', result.app);
            queryPill.textContent = result.searchTerm;
            
            const separator = document.createElement('span');
            separator.className = 'search-separator';
            separator.textContent = ' — ';
            
            const serviceName = document.createElement('span');
            serviceName.className = 'search-service';
            serviceName.textContent = `Search with ${result.app}`;
            
            textContainer.appendChild(queryPill);
            textContainer.appendChild(separator);
            textContainer.appendChild(serviceName);
            
            resultItem.appendChild(searchIconDiv);
            resultItem.appendChild(textContainer);
        } else {
            // --- Default Rendering Logic ---
            let iconSvg;
            switch(result.type) {
                case 'ai': iconSvg = sparkleIcon; break;
                case 'google': case 'suggestion': iconSvg = googleIcon; break;
                case 'history': 
                    // Use favicon for history items when possible
                    if (result.url) {
                        try {
                            const domain = new URL(result.url).hostname;
                            const favIcon = document.createElement('img');
                            favIcon.className = 'favicon';
                            favIcon.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
                            favIcon.onerror = () => {
                                // Fallback to history icon if favicon fails
                                favIcon.style.display = 'none';
                                const historyDiv = createIcon(historyIconSVG);
                                favIcon.parentNode.insertBefore(historyDiv, favIcon);
                            };
                            resultItem.appendChild(favIcon);
                            iconSvg = null; // Don't use SVG icon
                        } catch (e) {
                            iconSvg = historyIconSVG;
                        }
                    } else {
                        iconSvg = historyIconSVG;
                    }
                    break;
                case 'bookmark': 
                    // Use favicon for bookmarks when possible
                    if (result.url) {
                        try {
                            const domain = new URL(result.url).hostname;
                            const favIcon = document.createElement('img');
                            favIcon.className = 'favicon';
                            favIcon.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
                            favIcon.onerror = () => {
                                // Fallback to bookmark icon if favicon fails
                                favIcon.style.display = 'none';
                                const bookmarkDiv = createIcon(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5V2zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1H4z"/></svg>`);
                                favIcon.parentNode.insertBefore(bookmarkDiv, favIcon);
                            };
                            resultItem.appendChild(favIcon);
                            iconSvg = null; // Don't use SVG icon
                        } catch (e) {
                            iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5V2zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1H4z"/></svg>`;
                        }
                    } else {
                        iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v13.5a.5.5 0 0 1-.777.416L8 13.101l-5.223 2.815A.5.5 0 0 1 2 15.5V2zm2-1a1 1 0 0 0-1 1v12.566l4.723-2.482a.5.5 0 0 1 .554 0L13 14.566V2a1 1 0 0 0-1-1H4z"/></svg>`;
                    }
                    break;
                case 'calculator': iconSvg = result.isCopyResult ? copyIcon : calcIcon; break;
                case 'converter': iconSvg = convertIcon; break;
                case 'time': iconSvg = timeIcon; break;
                case 'color': iconSvg = colorIcon; break;
                case 'qr': iconSvg = qrIcon; break;
                case 'password': iconSvg = passwordIcon; break;
                case 'hash': iconSvg = hashIcon; break;
                case 'url_shorten': iconSvg = linkIcon; break;
                case 'ip_lookup': iconSvg = ipIcon; break;
                case 'lorem': iconSvg = textIcon; break;
                case 'base64_encode': case 'base64_decode': iconSvg = base64Icon; break;
                case 'setting': iconSvg = settingsIcon; break;
                case 'coin_flip': iconSvg = coinIcon; break;
                case 'roll_die': iconSvg = dieIcon; break;
                case 'random_number': iconSvg = randomIcon; break;
                case 'user_agent': iconSvg = textIcon; break;
                case 'navigation': 
                    // Use favicon if available, otherwise globe icon
                    if (result.favicon) {
                        const favIcon = document.createElement('img');
                        favIcon.className = 'favicon';
                        favIcon.src = result.favicon;
                        favIcon.onerror = () => {
                            // Fallback to globe icon if favicon fails
                            favIcon.style.display = 'none';
                            const globeDiv = createIcon(globeIcon);
                            favIcon.parentNode.insertBefore(globeDiv, favIcon);
                        };
                        resultItem.appendChild(favIcon);
                        iconSvg = null; // Don't use SVG icon
                    } else {
                        iconSvg = globeIcon;
                    }
                    break;
                // more cases...
            }
            if (iconSvg) {
                resultItem.appendChild(createIcon(iconSvg));
            } else if (result.type === 'tab') {
                const favIcon = document.createElement('img');
                favIcon.className = 'favicon';
                favIcon.src = result.favIconUrl || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iI2FhYSIgdmlld0JveD0iMCAwIDE2IDE2Ij48cGF0aCBkPSJNMTYgOC5BOSA4Ljg5MSAwIDAgMSAxMy45MjcgMTFINVYxLjA3M0E4Ljg5MSA4Ljg5MSAwIDAgMSA4IDB2MWE3LjY4IDcuNjggMCAwIDAgNS41MjUgMi4xMDJWOWEzIDMgMCAwIDEgMyAzSDh2M2E4Ljg5MSA4Ljg5MSAwIDAgMS0xMC45MjctNUgxMXYtM2EzIDMgMCAwIDEtMy0zVjEuNjMxQTcuNjggNy42OCAwIDAgMCAxIDguM3YxSDVWOGEyLjUgMi41IDAgMCAxIDUtMHYxSDV6bS00IDRhMSAxIDAgMSAwIDAtMiAxIDEgMCAwIDAgMCAyeiIvPjwvc3ZnPg==';
                resultItem.appendChild(favIcon);
            }

            const textContainer = document.createElement('div');
            textContainer.className = 'text-container';
            const title = document.createElement('span');
            title.className = 'title';
            title.textContent = result.title || result.text;
            textContainer.appendChild(title);

            if (result.type === 'tab') {
                const switchToTabLabel = document.createElement('span');
                switchToTabLabel.className = 'switch-to-tab-label';
                switchToTabLabel.textContent = 'Switch to Tab';
                resultItem.appendChild(switchToTabLabel);
            }
            
            if (result.recentlySearched) {
                const recentLabel = document.createElement('span');
                recentLabel.className = 'recently-searched-label';
                recentLabel.textContent = 'Recently Searched';
                resultItem.appendChild(recentLabel);
            } else if (result.recentlyVisited) {
                const recentLabel = document.createElement('span');
                recentLabel.className = 'recently-searched-label'; // reuse styling
                recentLabel.textContent = 'Recently Visited';
                resultItem.appendChild(recentLabel);
            }
            
            if (result.answer && !result.isCopyResult) { // Don't show answer separately for copy results
                const answer = document.createElement('span');
                answer.className = 'answer';
                answer.textContent = result.answer;
                textContainer.appendChild(answer);
            }

            // Add color swatch for color results
            if (result.type === 'color' && result.colorData) {
                const colorSwatch = document.createElement('div');
                colorSwatch.className = 'color-swatch';
                colorSwatch.style.backgroundColor = `#${result.colorData.hex}`;
                colorSwatch.style.width = '20px';
                colorSwatch.style.height = '20px';
                colorSwatch.style.borderRadius = '4px';
                colorSwatch.style.border = '1px solid #ccc';
                colorSwatch.style.marginLeft = '8px';
                colorSwatch.style.flexShrink = '0';
                resultItem.appendChild(colorSwatch);
            }

            // Handle rich suggestions from Google or enriched suggestions
            if ((result.type === 'suggestion' || result.type === 'aggregated_suggestion') && i < 5) {
                let descriptionText = result.description;
                let imageUrl = result.image;
                
                // Try to enrich with Wikipedia if no description/image from Google
                if (!descriptionText || !imageUrl) {
                    const enriched = await enrichSuggestion(result.title);
                    if (enriched) {
                        descriptionText = descriptionText || enriched.description;
                        imageUrl = imageUrl || enriched.image;
                    }
                }
                
                // Add description if available
                if (descriptionText) {
                    const desc = document.createElement('div');
                    desc.className = 'description';

                    const fullText = descriptionText;
                    const maxLength = 240;
                    let truncatedText = fullText;

                    if (fullText.length > maxLength) {
                        const lastSpace = fullText.lastIndexOf(' ', maxLength);
                        truncatedText = fullText.substring(0, lastSpace > 0 ? lastSpace : maxLength) + '...';
                    }
                    desc.textContent = truncatedText;

                    desc.style.whiteSpace = 'normal';
                    desc.style.overflowWrap = 'break-word';
                    desc.style.color = '#a0a0a0';
                    desc.style.fontSize = '13px';
                    desc.style.lineHeight = '1.5';
                    desc.style.marginTop = '6px';
                    desc.style.paddingRight = '8px';
                    desc.style.fontWeight = '400';
                    textContainer.appendChild(desc);

                    // Mark as enriched to prevent repositioning conflicts
                    resultItem.dataset.enriched = 'true';
                    
                    // Only reposition the first enriched suggestion to avoid duplicates
                    setTimeout(() => {
                        const parent = resultItem.parentElement;
                        if (!parent) return;
                        
                        // Check if this is the first enriched suggestion
                        const enrichedItems = Array.from(parent.children).filter(el => el.dataset.enriched === 'true');
                        const isFirstEnriched = enrichedItems[0] === resultItem;
                        
                        if (isFirstEnriched) {
                            const siblings = Array.from(parent.children);
                            const firstPlainSuggestion = siblings.find(el => el.dataset.type === 'suggestion' && !el.dataset.enriched);
                            if (firstPlainSuggestion && firstPlainSuggestion !== resultItem) {
                                parent.insertBefore(resultItem, firstPlainSuggestion);
                            }
                        }
                    }, 0);
                }
                
                // Add image if available
                if (imageUrl) {
                    const icon = resultItem.querySelector('.favicon');
                    if (icon) {
                        if (icon.tagName === 'IMG') {
                            icon.src = imageUrl;
                            icon.style.borderRadius = '4px';
                            icon.style.objectFit = 'cover';
                        } else {
                            // Replace SVG icon with image
                            const newIcon = document.createElement('img');
                            newIcon.className = 'favicon';
                            newIcon.src = imageUrl;
                            newIcon.style.borderRadius = '4px';
                            newIcon.style.objectFit = 'cover';
                            icon.replaceWith(newIcon);
                        }
                    }
                }
            }
            
            resultItem.appendChild(textContainer);

            if (result.type === 'calculator' && !result.isCopyResult) { // Only add button for non-copy results
                const copyBtn = document.createElement('button');
                copyBtn.className = 'copy-btn';
                copyBtn.innerHTML = copyIcon;
                copyBtn.title = 'Copy answer';
                copyBtn.onclick = (e) => {
                    e.stopPropagation(); // prevent the result item's click event
                    navigator.clipboard.writeText(result.answer);
                    const titleEl = resultItem.querySelector('.title');
                    if (titleEl) {
                       const originalText = titleEl.textContent;
                       titleEl.textContent = 'Copied!';
                       setTimeout(() => { titleEl.textContent = originalText; }, 1000);
                    }
                };
                resultItem.appendChild(copyBtn);
            }
        }

        // --- On-click actions ---
        resultItem.onclick = () => {
            // Update adaptive learning stats for LunarRank
            if (window.__lunarUpdateAdaptive && query) {
                window.__lunarUpdateAdaptive(result, query);
            }
            
            if (result.isCopyResult) {
                navigator.clipboard.writeText(result.answer);
                const titleEl = resultItem.querySelector('.title');
                if (titleEl) {
                   const originalText = titleEl.textContent;
                   titleEl.textContent = 'Copied!';
                   setTimeout(() => { titleEl.textContent = originalText; }, 1000);
                }
                return; // Stop further execution
            }

            switch(result.type) {
                case 'engine_suggestion':
                    if (result.engineKey === 'google') {
                        searchInput.value = '';
                        search('');
                    } else {
                        searchInput.value = `@${result.engineKey} `;
                        search(searchInput.value);
                    }
                    searchInput.focus();
                    break;
                case 'tab':
                    browser.runtime.sendMessage({ action: "switchToTab", tabId: result.id, windowId: result.windowId });
                    break;
                case 'google': case 'suggestion': case 'app_search': case 'history': case 'bookmark':
                    browser.runtime.sendMessage({ action: "createTab", url: result.url || `https://www.google.com/search?q=${encodeURIComponent(result.text)}` });
                    break;
                case 'ai':
                    activateAIChat(result.query);
                    break;
                case 'url_shorten':
                    navigator.clipboard.writeText('Shortening...').then(() => {
                        fetch(`https://is.gd/create.php?format=json&url=${encodeURIComponent(result.originalUrl)}`)
                            .then(res => res.json())
                            .then(data => {
                                if (data.shorturl) {
                                    navigator.clipboard.writeText(data.shorturl);
                                    title.textContent = 'Copied Short URL!';
                                    setTimeout(() => { title.textContent = result.title; }, 1500);
                                }
                            });
                    });
                    break;
                case 'setting':
                    browser.runtime.sendMessage({ action: result.action });
                    break;
                case 'coin_flip':
                case 'roll_die':
                case 'random_number':
                    // Re-roll instead of copying
                    if (result.isRerollable) {
                        const titleEl = resultItem.querySelector('.title');
                        const answerEl = resultItem.querySelector('.answer');
                        if (titleEl) {
                            titleEl.textContent = 'Rolling...';
                            setTimeout(() => {
                                let newResult;
                                if (result.type === 'coin_flip') {
                                    newResult = Math.random() < 0.5 ? 'Heads' : 'Tails';
                                } else if (result.type === 'roll_die') {
                                    newResult = Math.floor(Math.random() * result.sides) + 1;
                                } else if (result.type === 'random_number') {
                                    newResult = Math.floor(Math.random() * (result.max - result.min + 1)) + result.min;
                                }
                                
                                // Update the result object
                                result.result = newResult;
                                result.answer = newResult.toString();
                                
                                // Update the display
                                titleEl.textContent = result.title;
                                if (answerEl) {
                                    answerEl.textContent = newResult.toString();
                                }
                            }, 300);
                        }
                    }
                    break;
                case 'ip_lookup':
                    // Actually fetch the IP address
                    const titleEl = resultItem.querySelector('.title');
                    if (titleEl) {
                        titleEl.textContent = 'Getting IP...';
                        fetch('https://api.ipify.org?format=json')
                            .then(response => response.json())
                            .then(data => {
                                navigator.clipboard.writeText(data.ip);
                                titleEl.textContent = `IP: ${data.ip} (Copied!)`;
                                setTimeout(() => { titleEl.textContent = result.title; }, 2000);
                            })
                            .catch(() => {
                                titleEl.textContent = 'Error fetching IP';
                                setTimeout(() => { titleEl.textContent = result.title; }, 2000);
                            });
                    }
                    break;
                case 'qr':
                    // Actually generate and show QR code
                    if (result.text) {
                        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(result.text)}`;
                        // Create a new tab with the QR code
                        browser.runtime.sendMessage({ action: "createTab", url: qrUrl });
                    }
                    break;
                case 'color':
                    activateColorPicker(result);
                    break;
                case 'navigation':
                    browser.runtime.sendMessage({ action: "createTab", url: result.url });
                    break;
                default: // Default copy-to-clipboard for most tools
                    if(result.answer || result.result) {
                        navigator.clipboard.writeText(result.answer || result.result.toString());
                        const titleEl = resultItem.querySelector('.title');
                        if (titleEl) {
                           const originalText = titleEl.textContent;
                           titleEl.textContent = 'Copied!';
                           setTimeout(() => { titleEl.textContent = originalText; }, 1000);
                        }
                    }
                    break;
            }
        };

        resultsDiv.appendChild(resultItem);
    });

    if (currentResults.length > 0) {
        selectedIndex = 0;
        updateSelection();
    }
}

function restoreChat() {
    chatWasHidden = false;
    isChatActive = true;
    updateRestoreChatButtonVisibility();
    
    // Add chat-active class for styling
    document.body.classList.add('chat-active');
    
    // Animate iframe expansion
    window.parent.postMessage({ action: "expandForChat" }, "*");
    
    // Show the chat tile
    chatTileContainer.style.display = 'block';
    chatTileContainer.style.height = '260px';
    chatTileContainer.style.overflow = 'visible';
    
    // Restore current chat session if it exists
    if (currentChatId && chatSessions.has(currentChatId)) {
        const session = chatSessions.get(currentChatId);
        
        // Restore messages if they exist
        if (session.messages.length > 0 && chatHistory) {
            chatHistory.innerHTML = '';
            session.messages.forEach(msg => {
                const messageEl = document.createElement('div');
                messageEl.className = `chat-message ${msg.type}-message`;
                messageEl.innerHTML = msg.html;
                
                // Add click handlers for Ask Mooncow hyperlinks
                messageEl.querySelectorAll('.ask-mooncow-link').forEach(link => {
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        const question = decodeURIComponent(link.dataset.question).replace(/\+/g, ' ');
                        if (followupInput) {
                            followupInput.value = question;
                            // Auto-send the message
                            const sendEvent = new Event('keydown');
                            sendEvent.key = 'Enter';
                            followupInput.dispatchEvent(sendEvent);
                        }
                    });
                });
                
                chatHistory.appendChild(messageEl);
            });
            
            // Restore scroll position
            setTimeout(() => {
                chatHistory.scrollTop = session.scrollPosition;
            }, 50);
        }
        
        // Restore follow-up input value
        if (followupInput && session.followupValue) {
            followupInput.value = session.followupValue;
        }
        
        // Restore expanded state
        if (session.isExpanded) {
            chatTileContainer.classList.add('expanded');
            chatTileContainer.style.height = '450px';
            const expandButton = chatTileContainer.querySelector('.chat-expand-button');
            if (expandButton) {
                expandButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>`;
                expandButton.title = 'Shrink chat';
            }
        }
    }
    
    // Focus the follow-up input
    focusFollowupInput();
}

function activateColorPicker(colorResult) {
    isChatActive = true;
    chatWasHidden = false;
    
    // Add chat-active class for styling
    document.body.classList.add('chat-active');
    
    // Animate iframe expansion
    window.parent.postMessage({ action: "expandForChat" }, "*");
    
    // Create color picker interface with dark theme
    chatTileContainer.innerHTML = '';
    chatTileContainer.style.display = 'flex';
    chatTileContainer.style.height = '400px';
    chatTileContainer.style.overflow = 'visible';
    chatTileContainer.style.flexDirection = 'column';
    chatTileContainer.style.padding = '20px';
    chatTileContainer.style.background = '#2d3748';
    chatTileContainer.style.borderRadius = '12px';
    chatTileContainer.style.color = '#ffffff';
    chatTileContainer.style.position = 'relative';
    
    // Add close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = '×';
    closeButton.style.position = 'absolute';
    closeButton.style.top = '10px';
    closeButton.style.right = '10px';
    closeButton.style.background = '#4a5568';
    closeButton.style.color = '#ffffff';
    closeButton.style.border = 'none';
    closeButton.style.borderRadius = '6px';
    closeButton.style.padding = '4px 8px';
    closeButton.style.width = 'auto';
    closeButton.style.height = 'auto';
    closeButton.style.cursor = 'pointer';
    closeButton.style.fontSize = '18px';
    closeButton.style.display = 'flex';
    closeButton.style.alignItems = 'center';
    closeButton.style.justifyContent = 'center';
    closeButton.onclick = closeChatTile;
    chatTileContainer.appendChild(closeButton);

    const expandButton = document.createElement('button');
    expandButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
    </svg>`;
    expandButton.className = 'chat-expand-button';
    expandButton.title = 'Expand chat';
    expandButton.onclick = () => {
        const isExpanded = chatTileContainer.classList.contains('expanded');
        if (isExpanded) {
            chatTileContainer.classList.remove('expanded');
            chatTileContainer.style.height = '260px';
            expandButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>`;
            expandButton.title = 'Expand chat';
        } else {
            chatTileContainer.classList.add('expanded');
            chatTileContainer.style.height = '450px';
            expandButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2 2h3"/>
            </svg>`;
            expandButton.title = 'Shrink chat';
        }
    };
    chatTileContainer.appendChild(expandButton);

    // Initialize color state
    let currentColor = colorResult.colorData ? {
        r: colorResult.colorData.r,
        g: colorResult.colorData.g,
        b: colorResult.colorData.b
    } : { r: 255, g: 0, b: 0 };

    // Color name section
    const colorNameSection = document.createElement('div');
    colorNameSection.style.textAlign = 'center';
    colorNameSection.style.marginBottom = '16px';
    const colorNameEl = document.createElement('div');
    colorNameEl.style.fontSize = '18px';
    colorNameEl.style.fontWeight = 'bold';
    colorNameEl.style.color = '#e2e8f0';
    colorNameSection.appendChild(colorNameEl);
    chatTileContainer.appendChild(colorNameSection);

    // Main color display
    const mainColorSection = document.createElement('div');
    mainColorSection.style.display = 'flex';
    mainColorSection.style.alignItems = 'center';
    mainColorSection.style.marginBottom = '20px';
    mainColorSection.style.gap = '16px';
    
    const mainColorSwatch = document.createElement('div');
    mainColorSwatch.style.width = '80px';
    mainColorSwatch.style.height = '80px';
    mainColorSwatch.style.borderRadius = '12px';
    mainColorSwatch.style.border = '3px solid #4a5568';
    mainColorSwatch.style.flexShrink = '0';
    
    const colorValues = document.createElement('div');
    colorValues.style.flex = '1';
    colorValues.style.fontSize = '14px';
    colorValues.style.color = '#cbd5e0';
    
    mainColorSection.appendChild(mainColorSwatch);
    mainColorSection.appendChild(colorValues);
    chatTileContainer.appendChild(mainColorSection);

    // Interactive color controls
    const controlsSection = document.createElement('div');
    controlsSection.style.marginBottom = '20px';
    
    // RGB Sliders
    const rgbControls = document.createElement('div');
    rgbControls.style.display = 'flex';
    rgbControls.style.flexDirection = 'column';
    rgbControls.style.gap = '10px';
    
    const createSlider = (label, value, max, color, callback) => {
        const sliderContainer = document.createElement('div');
        sliderContainer.style.display = 'flex';
        sliderContainer.style.alignItems = 'center';
        sliderContainer.style.gap = '10px';
        
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        labelEl.style.width = '20px';
        labelEl.style.fontSize = '12px';
        labelEl.style.color = color;
        labelEl.style.fontWeight = 'bold';
        
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = max.toString();
        slider.value = value.toString();
        slider.style.flex = '1';
        slider.style.height = '6px';
        slider.style.background = `linear-gradient(to right, #4a5568, ${color})`;
        slider.style.borderRadius = '3px';
        slider.style.outline = 'none';
        slider.style.cursor = 'pointer';
        
        const valueEl = document.createElement('span');
        valueEl.textContent = value.toString();
        valueEl.style.width = '30px';
        valueEl.style.fontSize = '12px';
        valueEl.style.color = '#e2e8f0';
        valueEl.style.textAlign = 'right';
        
        slider.oninput = (e) => {
            const newValue = parseInt(e.target.value);
            valueEl.textContent = newValue.toString();
            callback(newValue);
        };
        
        sliderContainer.appendChild(labelEl);
        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(valueEl);
        return sliderContainer;
    };
    
    const updateColor = () => {
        const hex = [currentColor.r, currentColor.g, currentColor.b]
            .map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
        const hsl = rgbToHsl(currentColor.r, currentColor.g, currentColor.b);
        
        mainColorSwatch.style.backgroundColor = `rgb(${currentColor.r}, ${currentColor.g}, ${currentColor.b})`;
        colorValues.innerHTML = `
            <div><strong>HEX:</strong> #${hex}</div>
            <div><strong>RGB:</strong> ${currentColor.r}, ${currentColor.g}, ${currentColor.b}</div>
            <div><strong>HSL:</strong> ${hsl}</div>
        `;
        
        // Update color name
        colorNameEl.textContent = getColorName(currentColor.r, currentColor.g, currentColor.b);
        
        // Update palette
        updatePalette();
    };
    
    rgbControls.appendChild(createSlider('R', currentColor.r, 255, '#ff6b6b', (value) => {
        currentColor.r = value;
        updateColor();
    }));
    rgbControls.appendChild(createSlider('G', currentColor.g, 255, '#51cf66', (value) => {
        currentColor.g = value;
        updateColor();
    }));
    rgbControls.appendChild(createSlider('B', currentColor.b, 255, '#339af0', (value) => {
        currentColor.b = value;
        updateColor();
    }));
    
    controlsSection.appendChild(rgbControls);
    chatTileContainer.appendChild(controlsSection);
    
    // Color palette section
    const paletteSection = document.createElement('div');
    paletteSection.style.marginBottom = '16px';
    
    const paletteTitle = document.createElement('div');
    paletteTitle.textContent = 'Matching Colors';
    paletteTitle.style.fontSize = '14px';
    paletteTitle.style.fontWeight = 'bold';
    paletteTitle.style.marginBottom = '8px';
    paletteTitle.style.color = '#e2e8f0';
    
    const paletteContainer = document.createElement('div');
    paletteContainer.style.display = 'flex';
    paletteContainer.style.gap = '8px';
    paletteContainer.style.flexWrap = 'wrap';
    
    const updatePalette = () => {
        paletteContainer.innerHTML = '';
        const palette = generateColorPalette(currentColor.r, currentColor.g, currentColor.b);
        
        palette.forEach(color => {
            const swatch = document.createElement('div');
            swatch.style.width = '30px';
            swatch.style.height = '30px';
            swatch.style.borderRadius = '6px';
            swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
            swatch.style.border = '2px solid #4a5568';
            swatch.style.cursor = 'pointer';
            swatch.title = `RGB(${color.r}, ${color.g}, ${color.b})`;
            
            swatch.onclick = () => {
                currentColor = { ...color };
                updateColor();
                // Update sliders
                const sliders = rgbControls.querySelectorAll('input[type="range"]');
                const values = rgbControls.querySelectorAll('span:last-child');
                sliders[0].value = currentColor.r;
                sliders[1].value = currentColor.g;
                sliders[2].value = currentColor.b;
                values[0].textContent = currentColor.r.toString();
                values[1].textContent = currentColor.g.toString();
                values[2].textContent = currentColor.b.toString();
            };
            
            paletteContainer.appendChild(swatch);
        });
    };
    
    paletteSection.appendChild(paletteTitle);
    paletteSection.appendChild(paletteContainer);
    chatTileContainer.appendChild(paletteSection);
    
    // Native color input for quick selection
    const nativePicker = document.createElement('input');
    nativePicker.type = 'color';
    nativePicker.value = `#${[currentColor.r, currentColor.g, currentColor.b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
    nativePicker.style.width = '40px';
    nativePicker.style.height = '40px';
    nativePicker.style.border = 'none';
    nativePicker.style.cursor = 'pointer';
    nativePicker.oninput = (e) => {
        const hex = e.target.value.replace('#', '');
        currentColor = {
            r: parseInt(hex.substr(0, 2), 16),
            g: parseInt(hex.substr(2, 2), 16),
            b: parseInt(hex.substr(4, 2), 16)
        };
        updateColor();
        // Sync sliders
        const sliders = rgbControls.querySelectorAll('input[type="range"]');
        const values = rgbControls.querySelectorAll('span:last-child');
        sliders[0].value = currentColor.r;
        sliders[1].value = currentColor.g;
        sliders[2].value = currentColor.b;
        values[0].textContent = currentColor.r.toString();
        values[1].textContent = currentColor.g.toString();
        values[2].textContent = currentColor.b.toString();
    };
    mainColorSection.appendChild(nativePicker);
    
    // Copy buttons for HEX, RGB, HSL
    const copyGroup = document.createElement('div');
    copyGroup.style.display = 'flex';
    copyGroup.style.gap = '8px';
    copyGroup.style.flexWrap = 'wrap';

    const makeCopyBtn = (label, getText) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.padding = '8px 14px';
        btn.style.backgroundColor = '#4a5568';
        btn.style.color = 'white';
        btn.style.border = 'none';
        btn.style.borderRadius = '6px';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '12px';
        btn.onclick = () => {
            navigator.clipboard.writeText(getText());
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = label, 1000);
        };
        return btn;
    };

    const hexBtn = makeCopyBtn('Copy HEX', () => `#${[currentColor.r, currentColor.g, currentColor.b].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`);
    const rgbBtn = makeCopyBtn('Copy RGB', () => `rgb(${currentColor.r}, ${currentColor.g}, ${currentColor.b})`);
    const hslBtn = makeCopyBtn('Copy HSL', () => rgbToHsl(currentColor.r, currentColor.g, currentColor.b));

    copyGroup.appendChild(hexBtn);
    copyGroup.appendChild(rgbBtn);
    copyGroup.appendChild(hslBtn);
    chatTileContainer.appendChild(copyGroup);
    
    // Initialize display
    updateColor();
}

// Helper function to get color name
function getColorName(r, g, b) {
    const colorNames = [
        { name: "Red", r: 255, g: 0, b: 0 },
        { name: "Green", r: 0, g: 255, b: 0 },
        { name: "Blue", r: 0, g: 0, b: 255 },
        { name: "Yellow", r: 255, g: 255, b: 0 },
        { name: "Cyan", r: 0, g: 255, b: 255 },
        { name: "Magenta", r: 255, g: 0, b: 255 },
        { name: "Orange", r: 255, g: 165, b: 0 },
        { name: "Purple", r: 128, g: 0, b: 128 },
        { name: "Pink", r: 255, g: 192, b: 203 },
        { name: "Brown", r: 165, g: 42, b: 42 },
        { name: "Gray", r: 128, g: 128, b: 128 },
        { name: "Black", r: 0, g: 0, b: 0 },
        { name: "White", r: 255, g: 255, b: 255 },
        { name: "Lime", r: 0, g: 255, b: 0 },
        { name: "Navy", r: 0, g: 0, b: 128 },
        { name: "Teal", r: 0, g: 128, b: 128 },
        { name: "Silver", r: 192, g: 192, b: 192 },
        { name: "Maroon", r: 128, g: 0, b: 0 },
        { name: "Olive", r: 128, g: 128, b: 0 },
        { name: "Aqua", r: 0, g: 255, b: 255 },
        { name: "Fuchsia", r: 255, g: 0, b: 255 },
        { name: "Coral", r: 255, g: 127, b: 80 },
        { name: "Salmon", r: 250, g: 128, b: 114 },
        { name: "Khaki", r: 240, g: 230, b: 140 },
        { name: "Violet", r: 238, g: 130, b: 238 },
        { name: "Indigo", r: 75, g: 0, b: 130 },
        { name: "Turquoise", r: 64, g: 224, b: 208 },
        { name: "Gold", r: 255, g: 215, b: 0 },
        { name: "Crimson", r: 220, g: 20, b: 60 },
        { name: "Forest Green", r: 34, g: 139, b: 34 },
        { name: "YellowGreen", r: 154, g: 205, b: 50 },
        { name: "HoneyDew", r: 240, g: 255, b: 240 },
        { name: "MintCream", r: 245, g: 255, b: 250 },
        { name: "Azure", r: 240, g: 255, b: 255 },
        { name: "AliceBlue", r: 240, g: 248, b: 255 },
        { name: "GhostWhite", r: 248, g: 248, b: 255 },
        { name: "Snow", r: 255, g: 250, b: 250 },
        { name: "Ivory", r: 255, g: 255, b: 240 },
        { name: "Linen", r: 250, g: 240, b: 230 },
        { name: "SeaShell", r: 255, g: 245, b: 238 },
        { name: "Beige", r: 245, g: 245, b: 220 },
        { name: "OldLace", r: 253, g: 245, b: 230 },
        { name: "FloralWhite", r: 255, g: 250, b: 240 },
        { name: "AntiqueWhite", r: 250, g: 235, b: 215 },
        { name: "PapayaWhip", r: 255, g: 239, b: 213 },
        { name: "BlanchedAlmond", r: 255, g: 235, b: 205 },
        { name: "Bisque", r: 255, g: 228, b: 196 },
        { name: "PeachPuff", r: 255, g: 218, b: 185 },
        { name: "NavajoWhite", r: 255, g: 222, b: 173 },
        { name: "Moccasin", r: 255, g: 228, b: 181 },
        { name: "Cornsilk", r: 255, g: 248, b: 220 },
        { name: "LemonChiffon", r: 255, g: 250, b: 205 },
        { name: "LightGoldenrodYellow", r: 250, g: 250, b: 210 },
        { name: "LavenderBlush", r: 255, g: 240, b: 245 },
        { name: "MistyRose", r: 255, g: 228, b: 225 },
        { name: "Plum", r: 221, g: 160, b: 221 },
        { name: "Thistle", r: 216, g: 191, b: 216 },
        { name: "Orchid", r: 218, g: 112, b: 214 },
        { name: "VioletRed", r: 208, g: 32, b: 144 },
        { name: "HotPink", r: 255, g: 105, b: 180 },
        { name: "Pink", r: 255, g: 192, b: 203 },
        { name: "LightPink", r: 255, g: 182, b: 193 },
        { name: "PaleVioletRed", r: 219, g: 112, b: 147 },
        { name: "Crimson", r: 220, g: 20, b: 60 },
        { name: "Red", r: 255, g: 0, b: 0 },
        { name: "FireBrick", r: 178, g: 34, b: 34 },
        { name: "DarkRed", r: 139, g: 0, b: 0 },
        { name: "Maroon", r: 128, g: 0, b: 0 },
        { name: "White", r: 255, g: 255, b: 255 }
    ];
    
    let closestColor = colorNames[0];
    let minDistance = Infinity;
    
    colorNames.forEach(color => {
        const distance = Math.sqrt(
            Math.pow(r - color.r, 2) + 
            Math.pow(g - color.g, 2) + 
            Math.pow(b - color.b, 2)
        );
        if (distance < minDistance) {
            minDistance = distance;
            closestColor = color;
        }
    });
    
    return closestColor.name;
}

// Helper function to generate color palette
function generateColorPalette(r, g, b) {
    const palette = [];
    
    // Complementary color
    palette.push({ r: 255 - r, g: 255 - g, b: 255 - b });
    
    // Lighter versions
    palette.push({ 
        r: Math.min(255, r + 50), 
        g: Math.min(255, g + 50), 
        b: Math.min(255, b + 50) 
    });
    palette.push({ 
        r: Math.min(255, r + 100), 
        g: Math.min(255, g + 100), 
        b: Math.min(255, b + 100) 
    });
    
    // Darker versions
    palette.push({ 
        r: Math.max(0, r - 50), 
        g: Math.max(0, g - 50), 
        b: Math.max(0, b - 50) 
    });
    palette.push({ 
        r: Math.max(0, r - 100), 
        g: Math.max(0, g - 100), 
        b: Math.max(0, b - 100) 
    });
    
    // Analogous colors (shift hue slightly)
    const hsl = rgbToHslValues(r, g, b);
    const analogous1 = hslToRgb((hsl.h + 30) / 360, hsl.s / 100, hsl.l / 100);
    const analogous2 = hslToRgb((hsl.h - 30) / 360, hsl.s / 100, hsl.l / 100);
    
    palette.push({ 
        r: Math.round(analogous1[0]), 
        g: Math.round(analogous1[1]), 
        b: Math.round(analogous1[2]) 
    });
    palette.push({ 
        r: Math.round(analogous2[0]), 
        g: Math.round(analogous2[1]), 
        b: Math.round(analogous2[2]) 
    });
    
    return palette;
}

// Helper function to convert RGB to HSL values
function rgbToHslValues(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// Helper function to convert RGB to HSL string
function rgbToHsl(r, g, b) {
    const hsl = rgbToHslValues(r, g, b);
    return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
}

// Helper function to convert HSL to RGB
function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h * 6) % 2 - 1));
    const m = l - c / 2;
    let r, g, b;

    if (h < 1/6) {
        [r, g, b] = [c, x, 0];
    } else if (h < 2/6) {
        [r, g, b] = [x, c, 0];
    } else if (h < 3/6) {
        [r, g, b] = [0, c, x];
    } else if (h < 4/6) {
        [r, g, b] = [0, x, c];
    } else if (h < 5/6) {
        [r, g, b] = [x, 0, c];
    } else {
        [r, g, b] = [c, 0, x];
    }

    return [
        Math.round((r + m) * 255),
        Math.round((g + m) * 255),
        Math.round((b + m) * 255)
    ];
}

async function activateAIChat(query) {
    isChatActive = true;
    chatWasHidden = false;
    document.body.classList.add('chat-active');
    window.parent.postMessage({ action: "expandForChat" }, "*");

    // Re-fetch up to ~8k characters of the current page for context
    let pageText = '';
    try {
        const resp = await browser.runtime.sendMessage({ action: 'getPageText' });
        pageText = resp && resp.text ? resp.text : '';
    } catch (_) {}

    // Create or get existing chat session
    if (!currentChatId) {
        currentChatId = createChatSession(query);
    }
    
    const session = chatSessions.get(currentChatId);
    // Build conversation: include PAGE_CONTEXT message once at the start of a new session
    let conversation;
    if (session.conversation.length > 0) {
        conversation = [...session.conversation];
    } else {
        conversation = [
            { role: 'user', content: `PAGE_CONTEXT:\n${pageText.substring(0, 8000)}` },
            { role: 'user', content: query }
        ];
    }

    if (chatHistory && followupInput) {
        // Chat already exists, just append to it
        if (session.conversation.length === 0) {
            // This is a new query on existing UI, add to conversation
            conversation.push({ role: 'user', content: query });
            session.conversation = [...conversation];
        }
        
        const userMessageEl = appendMessage(query, 'user', chatHistory);
        const thinkingMessage = aiProvider === 'google' ? 'Analyzing with smart AI (this may take a moment)...' : 'Thinking...';
        const thinkingMessageEl = appendMessage(thinkingMessage, 'ai', chatHistory, true);
        chatHistory.scrollTop = chatHistory.scrollHeight;

        // Start streaming tokens instead of waiting for full response
        startStreaming(aiProvider, conversation, thinkingMessageEl);

        const followupContainer = document.createElement('div');
        followupContainer.className = 'followup-container';
        followupInput = document.createElement('input');
        followupInput.type = 'text';
        followupInput.placeholder = 'Ask a follow up...';

        const clearButton = document.createElement('button');
        clearButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
        clearButton.className = 'clear-chat-button';
        clearButton.title = 'Clear chat';
        clearButton.onclick = () => {
            clearChatHistory();
            conversation.length = 0; // Also clear the internal conversation history
        };

        const sendButton = document.createElement('button');
        sendButton.textContent = 'Send';

        const handleFollowUp = () => {
            const followupQuery = followupInput.value;
            if (followupQuery.trim()) {
                conversation.push({ role: 'user', content: followupQuery });
                session.conversation = [...conversation];
                saveChatSessions();
                
                appendMessage(followupQuery, 'user', chatHistory);
                const followupThinkingMessage = aiProvider === 'google' ? 'Analyzing with smart AI (this may take a moment)...' : 'Thinking...';
                const thinkingFollowupEl = appendMessage(followupThinkingMessage, 'ai', chatHistory, true);
                followupInput.value = '';
                chatHistory.scrollTop = chatHistory.scrollHeight;

                // Start streaming tokens instead of waiting for full response
                startStreaming(aiProvider, conversation, thinkingFollowupEl);
            }
        };

        sendButton.onclick = handleFollowUp;
        followupInput.onkeydown = (e) => {
            if (e.key === 'Enter') handleFollowUp();
            // Auto-save followup input value
            setTimeout(() => updateCurrentChatSession(), 100);
        };

        followupContainer.appendChild(followupInput);
        
        // Create AI provider toggle directly in chat
        const aiToggle = document.createElement('div');
        aiToggle.id = 'ai-provider-toggle';
        aiToggle.className = 'ai-provider-toggle';
        
        const lightningBtn = document.createElement('button');
        lightningBtn.className = 'ai-provider-btn lightning-btn' + (aiProvider === 'cerebras' ? ' active' : '');
        lightningBtn.title = 'Fast AI (Cerebras)';
        lightningBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>';
        lightningBtn.onclick = () => switchAIProvider('cerebras');
        
        const brainBtn = document.createElement('button');
        brainBtn.className = 'ai-provider-btn brain-btn' + (aiProvider === 'google' ? ' active' : '');
        brainBtn.title = 'Smart AI (Google)';
        brainBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5a2.5 2.5 0 0 0-4.96-.46 2.5 2.5 0 0 0-1.98 3 2.5 2.5 0 0 0-1.32 4.24 3 3 0 0 0 .34 5.58 2.5 2.5 0 0 0 2.96 3.08A2.5 2.5 0 0 0 9.5 22v-1.5a2.5 2.5 0 0 0-1.5-2.29 2.5 2.5 0 0 1-1.05-4.19 2.5 2.5 0 0 1 2.05-2.17A2.5 2.5 0 0 1 12 9.5Z"></path><path d="M12 4.5a2.5 2.5 0 0 1 4.96-.46 2.5 2.5 0 0 1 1.98 3 2.5 2.5 0 0 1 1.32 4.24 3 3 0 0 1-.34 5.58 2.5 2.5 0 0 1-2.96 3.08A2.5 2.5 0 0 1 14.5 22v-1.5a2.5 2.5 0 0 1 1.5-2.29 2.5 2.5 0 0 0 1.05-4.19 2.5 2.5 0 0 0-2.05-2.17A2.5 2.5 0 0 0 12 9.5Z"></path></svg>';
        brainBtn.onclick = () => switchAIProvider('google');
        
        aiToggle.appendChild(lightningBtn);
        aiToggle.appendChild(brainBtn);
        followupContainer.appendChild(aiToggle);
        
        followupContainer.appendChild(clearButton);
        followupContainer.appendChild(sendButton);
        chatTileContainer.appendChild(followupContainer);

        setTimeout(() => followupInput.focus(), 100);
        return;
    }

    // Create new chat UI
    chatTileContainer.innerHTML = '';
    chatTileContainer.style.display = 'flex';
    chatTileContainer.style.height = '260px';
    chatTileContainer.style.overflow = 'visible';

    const closeButton = document.createElement('button');
    closeButton.innerHTML = '×';
    closeButton.className = 'chat-close-button';
    closeButton.onclick = closeChatTile;
    chatTileContainer.appendChild(closeButton);

    const expandButton = document.createElement('button');
    expandButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
    </svg>`;
    expandButton.className = 'chat-expand-button';
    expandButton.title = 'Expand chat';
    expandButton.onclick = () => {
        const isExpanded = chatTileContainer.classList.contains('expanded');
        if (isExpanded) {
            chatTileContainer.classList.remove('expanded');
            chatTileContainer.style.height = '260px';
            expandButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>`;
            expandButton.title = 'Expand chat';
        } else {
            chatTileContainer.classList.add('expanded');
            chatTileContainer.style.height = '450px';
            expandButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>`;
            expandButton.title = 'Shrink chat';
        }
        // Update session state
        updateCurrentChatSession();
    };
    chatTileContainer.appendChild(expandButton);

    chatHistory = document.createElement('div');
    chatHistory.className = 'chat-history';
    chatHistory.style.flexGrow = '1';
    chatTileContainer.appendChild(chatHistory);

    const userMessageEl = appendMessage(query, 'user', chatHistory);
    const thinkingMessage = aiProvider === 'google' ? 'Analyzing with smart AI (this may take a moment)...' : 'Thinking...';
    const thinkingMessageEl = appendMessage(thinkingMessage, 'ai', chatHistory, true);

    // Save initial conversation state
    session.conversation = [...conversation];
    saveChatSessions();

    // Start streaming tokens instead of waiting for full response
    startStreaming(aiProvider, conversation, thinkingMessageEl);

    const followupContainer = document.createElement('div');
    followupContainer.className = 'followup-container';
    followupInput = document.createElement('input');
    followupInput.type = 'text';
    followupInput.placeholder = 'Ask a follow up...';

    const clearButton = document.createElement('button');
    clearButton.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    clearButton.className = 'clear-chat-button';
    clearButton.title = 'Clear chat';
    clearButton.onclick = () => {
        clearChatHistory();
        conversation.length = 0; // Also clear the internal conversation history
    };

    const sendButton = document.createElement('button');
    sendButton.textContent = 'Send';

    const handleFollowUp = () => {
        const followupQuery = followupInput.value;
        if (followupQuery.trim()) {
            conversation.push({ role: 'user', content: followupQuery });
            session.conversation = [...conversation];
            saveChatSessions();
            
            appendMessage(followupQuery, 'user', chatHistory);
            const followupThinkingMessage = aiProvider === 'google' ? 'Analyzing with smart AI (this may take a moment)...' : 'Thinking...';
            const thinkingFollowupEl = appendMessage(followupThinkingMessage, 'ai', chatHistory, true);
            followupInput.value = '';
            chatHistory.scrollTop = chatHistory.scrollHeight;

            // Start streaming tokens instead of waiting for full response
            startStreaming(aiProvider, conversation, thinkingFollowupEl);
        }
    };

    sendButton.onclick = handleFollowUp;
    followupInput.onkeydown = (e) => {
        if (e.key === 'Enter') handleFollowUp();
        // Auto-save followup input value
        setTimeout(() => updateCurrentChatSession(), 100);
    };

    followupContainer.appendChild(followupInput);
    
    // Create AI provider toggle directly in chat
    const aiToggle = document.createElement('div');
    aiToggle.id = 'ai-provider-toggle';
    aiToggle.className = 'ai-provider-toggle';
    
    const lightningBtn = document.createElement('button');
    lightningBtn.className = 'ai-provider-btn lightning-btn' + (aiProvider === 'cerebras' ? ' active' : '');
    lightningBtn.title = 'Fast AI (Cerebras)';
    lightningBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>';
    lightningBtn.onclick = () => switchAIProvider('cerebras');
    
    const brainBtn = document.createElement('button');
    brainBtn.className = 'ai-provider-btn brain-btn' + (aiProvider === 'google' ? ' active' : '');
    brainBtn.title = 'Smart AI (Google)';
    brainBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4.5a2.5 2.5 0 0 0-4.96-.46 2.5 2.5 0 0 0-1.98 3 2.5 2.5 0 0 0-1.32 4.24 3 3 0 0 0 .34 5.58 2.5 2.5 0 0 0 2.96 3.08A2.5 2.5 0 0 0 9.5 22v-1.5a2.5 2.5 0 0 0-1.5-2.29 2.5 2.5 0 0 1-1.05-4.19 2.5 2.5 0 0 1 2.05-2.17A2.5 2.5 0 0 1 12 9.5Z"></path><path d="M12 4.5a2.5 2.5 0 0 1 4.96-.46 2.5 2.5 0 0 1 1.98 3 2.5 2.5 0 0 1 1.32 4.24 3 3 0 0 1-.34 5.58 2.5 2.5 0 0 1-2.96 3.08A2.5 2.5 0 0 1 14.5 22v-1.5a2.5 2.5 0 0 1 1.5-2.29 2.5 2.5 0 0 0 1.05-4.19 2.5 2.5 0 0 0-2.05-2.17A2.5 2.5 0 0 0 12 9.5Z"></path></svg>';
    brainBtn.onclick = () => switchAIProvider('google');
    
    aiToggle.appendChild(lightningBtn);
    aiToggle.appendChild(brainBtn);
    followupContainer.appendChild(aiToggle);
    
    followupContainer.appendChild(clearButton);
    followupContainer.appendChild(sendButton);
    chatTileContainer.appendChild(followupContainer);

    setTimeout(() => followupInput.focus(), 100);
    focusFollowupInput();
}

function clearChatHistory() {
    if (currentChatId && chatSessions.has(currentChatId)) {
        chatSessions.delete(currentChatId);
        saveChatSessions();
    }
    
    if (chatHistory) {
        chatHistory.innerHTML = '';
        // Also reset the internal JS variable for chat history
        chatHistory = null;
        followupInput = null;
    }
    
    currentChatId = null;
    chatWasHidden = false;
    updateRestoreChatButtonVisibility();
}

function closeChatTile() {
    if (!isChatActive) return;

    // Save current chat session state before closing
    updateCurrentChatSession();
    
    chatWasHidden = true; // Set this so the restore button appears
    hideChatTile();
    updateRestoreChatButtonVisibility();
}

function hideChatTile() {
    // This function is now only used for hiding during new searches
    // We keep chatHistory persistent
    if (!isChatActive) return;
    
    // Save current state before hiding
    updateCurrentChatSession();
    
    isChatActive = false;
    
    // Remove chat-active class when hiding
    document.body.classList.remove('chat-active');
    
    chatTileContainer.style.transition = 'height 0.2s ease-out';
    chatTileContainer.style.height = '0px';
    chatTileContainer.style.overflow = 'hidden';
    
    // Animate iframe contraction
    window.parent.postMessage({ action: "contractFromChat" }, "*");
    
    setTimeout(() => {
        chatTileContainer.style.display = 'none';
        chatTileContainer.style.transition = '';
    }, 200);
}

function appendMessage(text, type, container, isThinking = false) {
    const message = document.createElement('div');
    message.className = `chat-message ${type}-message`;
    
    if (type === 'ai' && isThinking) {
        message.innerHTML = `<details open><summary>Thinking… (click to expand)</summary><div class="thinking-content"></div></details><div class="answer-content"></div>`;
        addChatActions(message);
    } else if (type === 'ai') {
        // For AI messages, parse markdown
        const htmlContent = parseMarkdown(text);
        message.innerHTML = htmlContent;
        addChatActions(message);
        
        // Add click handlers for Ask Mooncow hyperlinks
        message.querySelectorAll('.ask-mooncow-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const question = decodeURIComponent(link.dataset.question).replace(/\+/g, ' ');
                if (followupInput) {
                    followupInput.value = question;
                    // Auto-send the message
                    const sendEvent = new Event('keydown');
                    sendEvent.key = 'Enter';
                    followupInput.dispatchEvent(sendEvent);
                }
            });
        });
    } else {
        message.textContent = text;
    }
    
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
    return message;
}

function updateAiMessage(element, newText) {
    // If the element contains a thinking details, keep it and render answer separately
    const answerEl = element.querySelector('.answer-content');
    const details = element.querySelector('details');
    const cleaned = stripThink(newText || '');
    if (details) details.open = false;
    if (answerEl) {
        answerEl.innerHTML = parseMarkdown(cleaned);
    } else {
        // Fallback: replace entire element content
        element.innerHTML = parseMarkdown(cleaned);
    }
    // Ensure actions exist for AI messages
    addChatActions(element);
    
    // Add click handlers for Ask Mooncow hyperlinks
    element.querySelectorAll('.ask-mooncow-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const question = decodeURIComponent(link.dataset.question).replace(/\+/g, ' ');
            if (followupInput) {
                followupInput.value = question;
                // Auto-send the message
                const sendEvent = new Event('keydown');
                sendEvent.key = 'Enter';
                followupInput.dispatchEvent(sendEvent);
            }
        });
    });
}

function stripThink(response) {
    let text = response || '';
    if (!text) return '';
    // If a closing appears without opening, drop everything before it
    if (/(?:^|[\s\S]*)<\/think>/i.test(text) && !/<think>/i.test(text)) {
        const parts = text.split(/<\/think>/i);
        text = parts.slice(1).join('</think>');
    }
    // Remove paired <think>...</think>
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // If opening remains without closing, drop all (pure thought)
    if (/<think>/i.test(text) && !/<\/think>/i.test(text)) {
        text = '';
    }
    return text.trim();
}

function streamAiResponse(element, response) {
    const cleanedResponse = stripThink(response);
    element.innerHTML = parseMarkdown(cleanedResponse);
}

// Add copy/delete actions below AI chat messages
function addChatActions(messageEl) {
    if (!messageEl || !messageEl.classList || !messageEl.classList.contains('ai-message')) return;
    if (messageEl.querySelector('.chat-actions')) return;
    const actions = document.createElement('div');
    actions.className = 'chat-actions';

    const makeBtn = (html, title) => {
        const btn = document.createElement('button');
        btn.className = 'chat-action-btn';
        btn.innerHTML = html;
        btn.title = title;
        return btn;
    };

    const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const trashIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';

    const copyBtn = makeBtn(copyIcon, 'Copy response');
    const deleteBtn = makeBtn(trashIcon, 'Delete message');

    copyBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const answerEl = messageEl.querySelector('.answer-content');
        const text = answerEl ? answerEl.innerText : messageEl.innerText;
        try {
            await navigator.clipboard.writeText((text || '').trim());
            copyBtn.classList.add('copied');
            setTimeout(() => copyBtn.classList.remove('copied'), 800);
        } catch (_) {}
    });

    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (messageEl && messageEl.parentElement) {
            messageEl.parentElement.removeChild(messageEl);
            try { updateCurrentChatSession(); } catch (_) {}
        }
    });

    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);
    messageEl.appendChild(actions);
}

// Simple LaTeX to HTML renderer for common math expressions
function renderLatex(latex, isBlock = false) {
    // A much more robust, recursive LaTeX-to-HTML renderer.
    // The general strategy is to handle environments, then commands with arguments, then symbols.
    let html = latex.trim();

    const recurse = (str) => renderLatex(str, false);

    // 0. Protect text environments first
    html = html.replace(/\\text\{([^}]+)\}/g, (match, text) => `<span class="latex-text">${text}</span>`);

    // 1. Environments (align, matrix)
    html = html.replace(/\\begin\{(bmatrix|align\*)\}([\s\S]*?)\\end\{(bmatrix|align\*)\}/g, (match, env, content) => {
        const className = env === 'bmatrix' ? 'latex-matrix' : 'latex-align';
        const rows = content.trim().split(/\\\\|\\cr/g).map(row => {
            const cells = row.split('&').map(cell => `<td>${recurse(cell.trim())}</td>`).join('');
            return `<tr>${cells}</tr>`;
        }).join('');
        return `<table class="${className}"><tbody>${rows}</tbody></table>`;
    });

    // 2. Commands with arguments (fractions, roots, fonts, etc.)
    html = html.replace(/\\binom\{([^}]+)\}\{([^}]+)\}/g, (match, n, k) => `<span class="latex-binom"><span>${recurse(n)}</span><span>${recurse(k)}</span></span>`);
    html = html.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, (match, num, den) => `<span class="latex-frac"><span class="latex-num">${recurse(num)}</span><span class="latex-den">${recurse(den)}</span></span>`);
    html = html.replace(/\\sqrt\{([^}]+)\}/g, (match, content) => `√(${recurse(content)})`);
    html = html.replace(/\\mathbb\{([^}]+)\}/g, (match, content) => `<span class="latex-mathbb">${content}</span>`);
    html = html.replace(/\\vec\{([^}]+)\}/g, (match, content) => `<span class="latex-vec">${recurse(content)}</span>`);

    // 3. Delimiters
    html = html.replace(/\\left\(/g, '<span class="latex-lparen">(</span>').replace(/\\right\)/g, '<span class="latex-rparen">)</span>');
    html = html.replace(/\\left\[/g, '<span class="latex-lparen">[</span>').replace(/\\right\]/g, '<span class="latex-rparen">]</span>');
    html = html.replace(/\\left\|/g, '<span class="latex-lparen">|</span>').replace(/\\right\|/g, '<span class="latex-rparen">|</span>');
    html = html.replace(/\\left\\\{/g, '<span class="latex-lparen">{</span>').replace(/\\right\\\}/g, '<span class="latex-rparen">}</span>');

    // 4. Super/subscripts (must handle complex ops first)
    html = html.replace(/\\(sum|prod|int|oint|iint|iiint)_{([^}]+)}\^{([^}]+)}/g, (match, op, sub, sup) => {
        const symbols = { sum: '∑', prod: '∏', int: '∫', oint: '∮', iint: '∬', iiint: '∭' };
        return `<span class="latex-integral">${symbols[op]}<sub>${recurse(sub)}</sub><sup>${recurse(sup)}</sup></span>`;
    });
    html = html.replace(/\^{([^}]+)}/g, (match, content) => `<sup>${recurse(content)}</sup>`);
    html = html.replace(/_{([^}]+)}/g, (match, content) => `<sub>${recurse(content)}</sub>`);
    html = html.replace(/\^([\w\d'])/g, '<sup>$1</sup>');
    html = html.replace(/_([\w\d'])/g, '<sub>$1</sub>');

    // 5. Symbol and spacing replacements
    const replacements = {
        '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\epsilon': 'ε', '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ', '\\iota': 'ι', '\\kappa': 'κ', '\\lambda': 'λ', '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ', '\\pi': 'π', '\\rho': 'ρ', '\\sigma': 'σ', '\\tau': 'τ', '\\upsilon': 'υ', '\\phi': 'φ', '\\chi': 'χ', '\\psi': 'ψ', '\\omega': 'ω',
        '\\Gamma': 'Γ', '\\Delta': 'Δ', '\\Theta': 'Θ', '\\Lambda': 'Λ', '\\Xi': 'Ξ', '\\Pi': 'Π', '\\Sigma': 'Σ', '\\Phi': 'Φ', '\\Psi': 'Ψ', '\\Omega': 'Ω',
        '\\infty': '∞', '\\hbar': 'ℏ', '\\nabla': '∇', '\\partial': '∂', '\\sum': '∑', '\\prod': '∏', '\\int': '∫', '\\oint': '∮', '\\iint': '∬',
        '\\pm': '±', '\\mp': '∓', '\\times': '×', '\\div': '÷', '\\cdot': '⋅', '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\approx': '≈', '\\equiv': '≡', '\\propto': '∝',
        '\\in': '∈', '\\notin': '∉', '\\subset': '⊂', '\\supset': '⊃', '\\cap': '∩', '\\cup': '∪', '\\land': '∧', '\\lor': '∨', '\\neg': '¬',
        '\\forall': '∀', '\\exists': '∃', '\\emptyset': '∅',
        '\\to': '→', '\\rightarrow': '→', '\\leftarrow': '←', '\\leftrightarrow': '↔', '\\Rightarrow': '⇒', '\\Leftarrow': '⇐', '\\Leftrightarrow': '⇔', '\\implies': '⇒',
        '\\sin': 'sin', '\\cos': 'cos', '\\tan': 'tan', '\\ln': 'ln', '\\log': 'log', '\\exp': 'exp', 'det': 'det', 'rank': 'rank',
        '\\quad': '<span class="latex-space-quad"></span>', '\\qquad': '<span class="latex-space-qquad"></span>', '\\,': '<span class="latex-space-thin"></span>', '\\;': '<span class="latex-space-thick"></span>', '\\!': '<span class="latex-space-neg-thin"></span>',
        '\\dots': '…', '\\cdots': '⋯'
    };
    
    for (const [key, value] of Object.entries(replacements)) {
        html = html.replace(new RegExp(key.replace(/\\/g, '\\\\'), 'g'), value);
    }
        
    // Clean up remaining braces that were for grouping
    return html.replace(/\{|\}/g, '');
}

// Enhanced markdown parser with tables, LaTeX, and better formatting
function parseMarkdown(text) {
    const protectedContent = {};
    let protectedIndex = 0;
    
    const protect = (content, type) => {
        const placeholder = `%%PROTECTED_${protectedIndex++}%%`;
        protectedContent[placeholder] = { content, type };
        return placeholder;
    };
    
    const restore = (text) => {
        Object.keys(protectedContent).forEach(placeholder => {
            const item = protectedContent[placeholder];
            let finalContent;

            if (item.type === 'latex-block') {
                finalContent = `<div class="latex-block">${renderLatex(item.content, true)}</div>`;
            } else if (item.type === 'latex-inline') {
                finalContent = `<span class="latex-inline">${renderLatex(item.content, false)}</span>`;
            } else {
                finalContent = item.content; // Already pre-formatted HTML
            }
            text = text.replace(new RegExp(placeholder, 'g'), finalContent);
        });
        return text;
    };

    // Step 1: Protect raw LaTeX content and pre-formatted code blocks
    let processedText = text
        .replace(/```latex\n?([\s\S]*?)```/g, (match, latex) => protect(latex, 'latex-block'))
        .replace(/<latex>(.*?)<\/latex>/g, (match, latex) => protect(latex, 'latex-inline'))
        .replace(/```([a-zA-Z]*)\n?([\s\S]*?)```/g, (match, lang, code) => 
            protect(`<pre><code class="language-${lang}">${code}</code></pre>`, 'html'))
        .replace(/`([^`]+)`/g, (match, code) => protect(`<code>${code}</code>`, 'html'));

    // Step 1.5: Convert GitHub-style Markdown tables into HTML (with header separator row)
    const toCells = (line) => {
        if (!/\|/.test(line)) return null;
        let s = line.trim();
        if (s.startsWith('|')) s = s.slice(1);
        if (s.endsWith('|')) s = s.slice(0, -1);
        const parts = s.split('|').map(c => c.trim());
        return parts.length > 0 ? parts : null;
    };
    const isSeparatorRow = (line, cols) => {
        let s = line.trim();
        if (s.startsWith('|')) s = s.slice(1);
        if (s.endsWith('|')) s = s.slice(0, -1);
        const segs = s.split('|').map(c => c.trim());
        if (cols && segs.length !== cols) return false;
        return segs.every(c => /^:?-{3,}:?$/.test(c));
    };
    const lines = processedText.split('\n');
    let outLines = [];
    for (let i = 0; i < lines.length; i++) {
        const headerCells = toCells(lines[i]);
        if (headerCells && i + 1 < lines.length && isSeparatorRow(lines[i + 1], headerCells.length)) {
            // Build table block
            let j = i + 2;
            const rows = [];
            while (j < lines.length) {
                const rc = toCells(lines[j]);
                if (!rc) break;
                rows.push(rc);
                j++;
            }
            const thead = `<thead><tr>${headerCells.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
            const tbody = rows.length
                ? `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`
                : '<tbody></tbody>';
            const htmlTable = `<div class="table-wrapper"><table class="markdown-table">${thead}${tbody}</table></div>`;
            outLines.push(protect(htmlTable, 'html'));
            i = j - 1; // advance
            continue;
        }
        outLines.push(lines[i]);
    }
    processedText = outLines.join('\n');

    // Step 2: Escape HTML and process markdown on the rest.
    processedText = processedText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // (Tables handled above with proper header detection)
        
        // Headers: #### ### ## #
        .replace(/^#### (.*$)/gm, '<h4>$1</h4>')
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        
        // Blockquotes: > text
        .replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>')
        
        // Horizontal rules: --- or ***
        .replace(/^(---|\*\*\*)$/gm, '<hr>')
        
        // Strikethrough: ~~text~~
        .replace(/~~(.*?)~~/g, '<del>$1</del>')
        
        // Bold: **text** or __text__
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.*?)__/g, '<strong>$1</strong>')
        
        // Italic: *text* or _text_ (but not inside words)
        .replace(/(?:^|[^a-zA-Z0-9])\*([^*\s](?:[^*]*[^*\s])?)\*(?![a-zA-Z0-9])/g, (match, p1, offset, string) => {
            const before = string[offset] || '';
            return before + '<em>' + p1 + '</em>';
        })
        .replace(/(?:^|[^a-zA-Z0-9])_([^_\s](?:[^_]*[^_\s])?)_(?![a-zA-Z0-9])/g, (match, p1, offset, string) => {
            const before = string[offset] || '';
            return before + '<em>' + p1 + '</em>';
        })
        
        // Numbered lists: 1. item
        .replace(/^\d+\. (.*)$/gm, '<oli>$1</oli>')
        
        // Bullet lists: - item or * item
        .replace(/^[\-\*] (.*)$/gm, '<li>$1</li>')
        
        // Ask Mooncow hyperlinks: [text](ask://ask/question)
        .replace(/\[([^\]]+)\]\(ask:\/\/ask\/([^)]+)\)/g, '<a href="#" class="ask-mooncow-link" data-question="$2">$1</a>')
        
        // Regular links: [text](url)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        
        // Wrap consecutive <li> elements in <ul>
        .replace(/(<li>.*<\/li>(?:\s*<li>.*<\/li>)*)/gs, '<ul>$1</ul>')
        
        // Wrap consecutive <oli> elements in <ol>
        .replace(/(<oli>.*<\/oli>(?:\s*<oli>.*<\/oli>)*)/gs, '<ol>$1</ol>')
        .replace(/<oli>/g, '<li>')
        .replace(/<\/oli>/g, '</li>')
        
        // Paragraphs: double line breaks create new paragraphs
        .replace(/\n\s*\n/g, '</p><p>')
        .replace(/^/, '<p>')
        .replace(/$/, '</p>')
        
        // Single line breaks within paragraphs
        .replace(/\n/g, '<br>');
    
    // Step 3: Restore protected content, rendering LaTeX at this stage.
    return restore(processedText);
}

const debounce = (fn, ms = 150) => {
  let t; return (...a) => {
    clearTimeout(t); t = setTimeout(() => fn(...a), ms);
  };
};

let currentSearchPromise = null;
let lastSearchQuery = '';

function search(query) {
    const q = query.trim();
    lastSearchQuery = query; // Store the latest query

    // --- Special handling for "@" commands ---
    const appDetectorResult = window.searchDetectors.detectAppSearch(q);
    
    if (appDetectorResult && appDetectorResult.type === 'show_app_suggestions') {
        const appSuggestions = Object.entries(appDetectorResult.apps).map(([key, appInfo]) => ({
            type: 'engine_suggestion', // a new type
            title: `Search with ${appInfo.name}`,
            engineKey: key,
            icon: appInfo.name === 'Google' ? googleIcon : null,
            domain: new URL(appInfo.url).hostname
        }));
        
        // Add Google to the top if the query is just "@"
        if (q === '@') {
            appSuggestions.unshift({
                type: 'engine_suggestion',
                title: 'Search with Google',
                engineKey: 'google',
                icon: googleIcon,
                domain: 'google.com'
            });
        }

        // We have our list, call displayResults directly and bypass ranking
        displayResults([], '', [], appSuggestions); // Pass as a fourth, override argument
        return Promise.resolve();
    }

    const tabSearch = browser.runtime.sendMessage({ action: "searchTabs", query: query });
    const historyPromise = browser.runtime.sendMessage({ action: "searchHistory", query: query });
    const bookmarkPromise = browser.runtime.sendMessage({ action: "searchBookmarks", query: query });

    if (!query.trim()) {
        const promise = tabSearch.then(tabResults => displayResults(tabResults, query));
        currentSearchPromise = promise;
        return promise;
    }

    const suggestionsFetch = aggregateSuggestions(query);

    const searchPromise = Promise.all([suggestionsFetch, tabSearch, historyPromise, bookmarkPromise]).then(async ([suggestions, tabResults, historyResults, bookmarkResults]) => {
        // Only update results if this is still the latest search
        if (query === lastSearchQuery) {
            
            let rankableCandidates = [];
            
            if (query && query.trim().length > 0) {
                const detectors = window.searchDetectors;
                let specialResults = [];
                
                if (detectors) {
                    specialResults = Object.values(detectors)
                        .map(detector => {
                            try {
                                return detector(query);
                            } catch (e) {
                                console.warn('Detector error:', e);
                                return null;
                            }
                        })
                        .filter(result => result !== null && result.type !== 'show_app_suggestions');
                }

                // Always add AI and Google search as fallbacks
                specialResults.push({ type: 'ai', query: query, title: `Ask AI: "${query}"` });
                specialResults.push({ type: 'google', query: query, text: query, title: `Search Google for "${query}"`});
                
                rankableCandidates = [...specialResults];
            }

            // Smart history processing - dedupe and limit to 2-3 items
            const processedHistory = processHistoryResults(historyResults, suggestions, query);
            
            // Strict domain-prefix autofill candidates from recent history + open tabs
            const autofill = await getAutofillCandidates(query);
            
            // Add all our sources to the ranking pool
            rankableCandidates.push(...autofill);
            rankableCandidates.push(...processedHistory);
            rankableCandidates.push(...bookmarkResults);
            rankableCandidates.push(...tabResults.map(tab => ({ ...tab, type: 'tab', text: tab.title })));
            rankableCandidates.push(...suggestions.map((s, index) => {
                // Handle rich suggestion objects
                if (typeof s === 'object' && s.text) {
                    const answerMatch = s.text.match(/^\s*=\s*(.+)$/);
                    if (answerMatch) {
                        return {
                            type: 'calculator',
                            text: s.text,
                            title: answerMatch[1].trim(),
                            answer: answerMatch[1].trim(),
                            isCopyResult: true,
                            remoteRank: index
                        };
                    }
                    return { 
                        type: 'suggestion', 
                        text: s.text, 
                        title: s.text, 
                        image: s.image || null,
                        description: s.description || null,
                        remoteRank: index 
                    };
                }
                
                // Handle simple string suggestions
                const textValue = typeof s === 'string' ? s : s.toString();
                const answerMatch = textValue.match(/^\s*=\s*(.+)$/);
                if (answerMatch) {
                    return {
                        type: 'calculator',
                        text: textValue,
                        title: answerMatch[1].trim(),
                        answer: answerMatch[1].trim(),
                        isCopyResult: true,
                        remoteRank: index
                    };
                }
                return { type: 'suggestion', text: textValue, title: textValue, remoteRank: index };
            }));

            const rankedResults = window.rankResults(rankableCandidates, query);
            
            // Final deduplication to prevent any knowledge panel duplicates
            const finalResults = [];
            const seenResultTexts = new Set();
            
            rankedResults.forEach(result => {
                const resultText = (result.text || result.title || '').toLowerCase().trim();
                if (!seenResultTexts.has(resultText) && resultText.length > 0) {
                    finalResults.push(result);
                    seenResultTexts.add(resultText);
                }
            });
            
            displayResults(tabResults, query, suggestions, null, finalResults);
        }
    });
    
    currentSearchPromise = searchPromise;
    return searchPromise;
}

// New function to intelligently process history results
function processHistoryResults(historyResults, suggestions, query) {
    if (!historyResults || historyResults.length === 0) return [];

    const qNorm = (query || '').toLowerCase().trim();
    // Sort history by recency (most recent first)
    const sortedHistory = historyResults.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));

    // Deduplicate against suggestions first (avoid showing same thing twice)
    const suggestionTexts = new Set((suggestions || []).map(s => (typeof s === 'string' ? s : s.text || '').toLowerCase().trim()));

    const results = [];
    const seenDomains = new Set();
    const seenSearchQueries = new Set();

    for (const item of sortedHistory) {
        if (!item.url) continue;
        let urlObj;
        try {
            urlObj = new URL(item.url);
        } catch (_) { continue; }

        const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');
        const pathname = urlObj.pathname || '';

        // Detect Google web search queries only
        const isGoogleHost = /(^|\.)google\./.test(hostname);
        const isGoogleSearchPath = pathname === '/search';
        const sp = new URLSearchParams(urlObj.search || '');
        const gQuery = sp.get('q');
        const isGoogleSearch = Boolean(isGoogleHost && isGoogleSearchPath && gQuery && gQuery.trim());

        // Skip generic/untitled
        const normalizedTitle = (item.title || '').toLowerCase().trim();
        if (normalizedTitle.includes('untitled')) continue;

        if (isGoogleSearch) {
            const searchText = gQuery.trim();
            const key = searchText.toLowerCase();
            if (seenSearchQueries.has(key)) continue;
            // Avoid duplicating engine suggestion text
            if (suggestionTexts.has(key)) continue;
            seenSearchQueries.add(key);

            results.push({
                type: 'google',
                text: searchText,
                query: searchText,
                title: `Search Google for "${searchText}"`,
                recentlySearched: true,
                lastVisitTime: item.lastVisitTime || 0
            });
        } else {
            // Treat all other sites as Go To navigation items by domain
            if (!hostname) continue;
            if (seenDomains.has(hostname)) continue;
            seenDomains.add(hostname);

            const displayDomain = hostname;
            const navUrl = `https://${displayDomain}`;
            // Avoid showing the exact same thing as the raw query
            if (displayDomain === qNorm) continue;

            // Only show "Recently Visited" if within the last 6 hours
            const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
            const isRecent = (Date.now() - (item.lastVisitTime || 0)) <= SIX_HOURS_MS;
            // Only include navigation entries that match domain prefix when a query exists
            const matchesPrefix = !qNorm || displayDomain.startsWith(qNorm);
            if (!matchesPrefix) continue;

            results.push({
                type: 'navigation',
                title: `Go to ${displayDomain}`,
                url: navUrl,
                domain: displayDomain,
                favicon: `https://www.google.com/s2/favicons?domain=${displayDomain}&sz=32`,
                recentlyVisited: isRecent,
                lastVisit: item.lastVisitTime || 0,
                visitCount: 1
            });
        }

        // Limit to 2-3 items max from history-derived additions
        if (results.length >= 3) break;
    }

    return results;
}

const debouncedSearch = debounce(search, 50);

searchInput.addEventListener('input', (e) => {
    const query = e.target.value;
    try { sessionStorage.setItem('mooncow_search_value', query); } catch (_) {}
    
    debouncedSearch(query);
});

searchInput.addEventListener('keydown', (e) => {
    const items = resultsDiv.querySelectorAll('.result-item');
    
    // Handle right arrow for app search autocomplete
    if (e.key === 'ArrowRight') {
        const currentValue = searchInput.value;
        const match = currentValue.match(/^@(\\w+)$/i);
        if (match) {
            const partial = match[1].toLowerCase();
                         // Find first matching app
             const apps = ['youtube', 'twitter', 'github', 'reddit', 'stackoverflow', 'amazon', 'ebay', 'bing', 'duckduckgo', 'netflix', 'spotify', 'linkedin', 'maps', 'drive', 'gmail'];
            const matchingApp = apps.find(app => app.startsWith(partial));
            if (matchingApp) {
                e.preventDefault();
                searchInput.value = `@${matchingApp} `;
                search(searchInput.value);
                return;
            }
        }
        
        // Handle autocomplete for selected result
        if (selectedIndex >= 0 && selectedIndex < currentResults.length) {
            const selectedResult = currentResults[selectedIndex];
            e.preventDefault();
            
            if (selectedResult.type === 'navigation') {
                searchInput.value = selectedResult.domain + ' ';
            } else if (selectedResult.type === 'suggestion' || selectedResult.type === 'google') {
                searchInput.value = selectedResult.text || selectedResult.title;
            }
            
            search(searchInput.value);
            return;
        }
        
        // Fallback to top result if nothing selected
        if (currentResults.length > 0) {
            const topResult = currentResults[0];
            if (topResult.type === 'navigation') {
                e.preventDefault();
                searchInput.value = topResult.domain + ' ';
                search(searchInput.value);
            }
        }
    }
    
    if (items.length === 0) return;

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % items.length;
            updateSelection();
            break;
        case 'ArrowUp':
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + items.length) % items.length;
            updateSelection();
            break;
        case 'Enter':
            e.preventDefault();
            
            const currentQuery = searchInput.value;
            
            let promiseToWait;
            if (currentQuery !== lastSearchQuery) {
                promiseToWait = search(currentQuery);
            } else {
                promiseToWait = currentSearchPromise || Promise.resolve();
            }
            
            promiseToWait.then(() => {
                // Re-get items after search completes
                const updatedItems = resultsDiv.querySelectorAll('.result-item');
                if (selectedIndex >= 0 && selectedIndex < updatedItems.length) {
                    const selectedResult = currentResults[selectedIndex];
                    
                    // Special handling for rerollable items
                    if (selectedResult.isRerollable && (selectedResult.type === 'coin_flip' || selectedResult.type === 'roll_die' || selectedResult.type === 'random_number')) {
                        updatedItems[selectedIndex].click(); // This will trigger the re-roll
                        return;
                    }
                    
                    // Special handling for Google answers - copy the answer directly
                    if (selectedResult.isCopyResult || (selectedResult.answer && (selectedResult.type === 'suggestion' || selectedResult.type === 'google'))) {
                        navigator.clipboard.writeText(selectedResult.answer);
                        // Show feedback
                        const resultItem = updatedItems[selectedIndex];
                        const titleElement = resultItem.querySelector('.title');
                        if (titleElement) {
                            const originalText = titleElement.textContent;
                            titleElement.textContent = 'Copied!';
                            setTimeout(() => { titleElement.textContent = originalText; }, 1000);
                        }
                        return;
                    }
                    
                    if (selectedResult.type === 'suggestion') {
                        browser.runtime.sendMessage({ action: "createTab", url: `https://www.google.com/search?q=${encodeURIComponent(selectedResult.text)}` });
                    } else {
                        updatedItems[selectedIndex].click();
                    }
                } else if (currentQuery.trim()) {
                    // If no results or invalid selection, search Google for the current query
                    browser.runtime.sendMessage({ action: "createTab", url: `https://www.google.com/search?q=${encodeURIComponent(currentQuery)}` });
                }
            });
            break;
    }
});

pinButton.addEventListener('click', togglePin);

restoreChatButton.addEventListener('click', () => {
    searchInput.value = '';
    search(''); // To clear the results
    restoreChat();
});

// Initial state
search('');
// Restore last search value for this tab/session if available
try {
    const saved = sessionStorage.getItem('mooncow_search_value');
    if (typeof saved === 'string' && saved.length > 0) {
        searchInput.value = saved;
        search(saved);
    }
} catch (_) {}
updatePinButton();
createHistoryButton();
loadChatSessions();
setTimeout(() => {
    loadAIProviderPreference(); // Load preferences after DOM is ready
}, 50);
setTimeout(() => {
    searchInput.focus();
}, 100); // Small delay to ensure iframe is ready

// ----- Clean drag handler rebuilt from scratch -----
(() => {
    const handle = dragHandle;
    if (!handle) return;

    let lastX = 0;
    let lastY = 0;

    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // Only left-click
        e.preventDefault();
        e.stopPropagation();

        lastX = e.screenX;
        lastY = e.screenY;

        window.parent.postMessage({ action: 'startDrag' }, '*');
        handle.setPointerCapture(e.pointerId);

        const onMove = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const dx = ev.screenX - lastX;
            const dy = ev.screenY - lastY;
            lastX = ev.screenX;
            lastY = ev.screenY;
            window.parent.postMessage({ action: 'moveDrag', dx, dy }, '*');
        };

        const onUp = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            handle.releasePointerCapture(ev.pointerId);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            window.parent.postMessage({ action: 'endDrag' }, '*');
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    });
})();

function fetchSuggestions(engine, query) {
    // Return cached suggestions if we already fetched them for this engine/query
    const cacheKey = `${engine}:${query}`;
    if (suggestionCache.has(cacheKey)) {
        return Promise.resolve(suggestionCache.get(cacheKey));
    }

    const endpoints = {
        // Enhanced Google suggestions endpoint with more personalization parameters
        google: `https://suggestqueries.google.com/complete/search?client=chrome&hl=en&gl=us&q=${encodeURIComponent(query)}`,
        ddg: `https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}`,
        yahoo: `https://search.yahoo.com/sugg/gossip/gossip-us-ura/?output=fd&command=${encodeURIComponent(query)}`
    };

    return fetch(endpoints[engine], { 
        credentials: 'include', // include credentials for personalized Google suggestions
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': navigator.userAgent,
            'Referer': 'https://www.google.com/',
            'X-Client-Type': 'browser'
        }
    })
        .then(res => res.json())
        .then(data => {
            let suggestions = [];
            if (engine === 'google') {
                // Google's new response format can include richer data
                if (Array.isArray(data) && data[1]) {
                    suggestions = data[1].map((item, index) => {
                        // Check if this is a rich suggestion with additional data
                        if (typeof item === 'object' && item.text) {
                            return {
                                text: item.text,
                                image: item.image || null,
                                type: item.type || 'suggestion',
                                description: item.description || null
                            };
                        }
                        // Fallback to simple string format
                        return typeof item === 'string' ? item : (item.text || item);
                    }).filter(s => s && (typeof s === 'string' || s.text));
                } else {
                    suggestions = data[1] || [];
                }
            }

            // Store in cache for future identical queries
            suggestionCache.set(cacheKey, suggestions);
            return suggestions;
        })
        .catch(() => []);
}

async function aggregateSuggestions(query) {
    // Only Google suggestions for a more personalized feel (cookies included)
    const engines = ['google'];
    const fetches = engines.map(e => fetchSuggestions(e, query));
    const allSuggestions = (await Promise.all(fetches)).flat();

    // Enhanced dedupe with fuzzy matching and exact text comparison
    const unique = [];
    const seenTexts = new Set();
    
    allSuggestions.forEach(s => {
        const text = typeof s === 'object' ? s.text : s;
        const normalizedText = text.toLowerCase().trim();
        
        // Skip if we've seen this exact text before
        if (seenTexts.has(normalizedText)) {
            return;
        }
        
        // Skip if it's too similar to any existing suggestion
        const isDuplicate = unique.some(u => {
            const uText = typeof u === 'object' ? u.text : u;
            const uNormalizedText = uText.toLowerCase().trim();
            return simpleLevenshtein(uNormalizedText, normalizedText) <= 2;
        });
        
        if (!isDuplicate) {
            unique.push(s);
            seenTexts.add(normalizedText);
        }
    });

    // Simple scoring: frequency based on text content
    const freq = {};
    allSuggestions.forEach(s => {
        const text = typeof s === 'object' ? s.text : s;
        freq[text] = (freq[text] || 0) + 1;
    });

    unique.sort((a, b) => {
        const aText = typeof a === 'object' ? a.text : a;
        const bText = typeof b === 'object' ? b.text : b;
        return (freq[bText] - freq[aText]) || aText.localeCompare(bText);
    });
    
    return unique.slice(0, 12);
}

function simpleLevenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = Array.from({length: a.length + 1}, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i-1] === b[j-1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i-1][j] + 1,
                matrix[i][j-1] + 1,
                matrix[i-1][j-1] + cost
            );
        }
    }
    return matrix[a.length][b.length];
}

function getDomainCore(domain) {
    if (!domain) return '';
    const noWww = domain.replace(/^www\./, '');
    return noWww.split('.')[0];
}

async function enrichSuggestion(suggestion) {
    // Try to get a summary and image from Wikipedia
    try {
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(suggestion)}`;
        const response = await fetch(url);
        if (!response.ok) {
            return null;
        }
        const data = await response.json();
        return {
            title: data.title || suggestion,
            description: data.extract,
            image: data.thumbnail ? data.thumbnail.source : null
        };
    } catch (error) {
        console.warn('Enrichment failed for:', suggestion, error);
        return null;
    }
}

// Cache for suggestion responses to avoid redundant network requests and speed things up
const suggestionCache = new Map();

// Streaming token handling
const streamHandlers = new Map();

browser.runtime.onMessage.addListener((msg) => {
    if (msg.streamId && msg.debug) {
        try { console.log('[Mooncow][stream]', msg.debug); } catch (_) {}
    }
    if (msg.streamId && (msg.token || msg.done || msg.error)) {
        const handler = streamHandlers.get(msg.streamId);
        if (handler) {
            handler(msg);
        }
    }
});

function startStreaming(aiProvider, conversation, thinkingEl) {
    const streamId = Math.random().toString(36).slice(2);
    const apiAction = aiProvider === 'google' ? 'streamGoogleCompletion' : 'streamCerebrasCompletion';
    const apiOptions = aiProvider === 'google' ? { includeScreenshot: true, includePdf: true } : {};

    let fullText = '';
    let thoughtText = '';
    const details = thinkingEl.querySelector('details');
    const thoughtEl = details ? details.querySelector('.thinking-content') : null;
    // Ensure we have a dedicated container for the final answer
    let answerEl = thinkingEl.querySelector('.answer-content');
    if (!answerEl) {
        answerEl = document.createElement('div');
        answerEl.className = 'answer-content';
        thinkingEl.appendChild(answerEl);
    }

    streamHandlers.set(streamId, (msg) => {
        if (msg.token) {
            // Google yields {type,text}; new Cerebras parser yields {type,text}; legacy Cerebras yields string
            const tokenObj = msg.token;
            if (typeof tokenObj === 'string') {
                fullText += tokenObj;
                if (answerEl) answerEl.innerHTML = parseMarkdown(fullText);
            } else if (tokenObj && typeof tokenObj === 'object') {
                if (tokenObj.type === 'thought') {
                    if (thoughtEl) {
                        thoughtText += tokenObj.text;
                        thoughtEl.textContent = thoughtText;
                    }
                } else if (tokenObj.type === 'answer') {
                    fullText += tokenObj.text;
                    if (answerEl) answerEl.innerHTML = parseMarkdown(fullText);
                }
            }
            thinkingEl.scrollTop = thinkingEl.scrollHeight;
        }
        if (msg.done || msg.error) {
            if (details) details.open = false;
            const finalText = stripThink(fullText || (msg.error ? `Error: ${msg.error}` : ''));
            if (answerEl) {
                answerEl.innerHTML = parseMarkdown(finalText);
            } else {
                updateAiMessage(thinkingEl, finalText);
            }

            // Persist the full assistant message into the current conversation/session
            if (!msg.error && Array.isArray(conversation)) {
                conversation.push({ role: 'assistant', content: finalText });
                if (currentChatId && chatSessions.has(currentChatId)) {
                    const session = chatSessions.get(currentChatId);
                    session.conversation = [...conversation];
                    saveChatSessions();
                }
            }

            streamHandlers.delete(streamId);
        }
    });

    browser.runtime.sendMessage({ action: apiAction, messages: conversation, options: apiOptions, streamId });
}

// Patch appendMessage for thinking dropdown
function appendMessage(text, type, container, isThinking = false) {
    const message = document.createElement('div');
    message.className = `chat-message ${type}-message`;
    if (type === 'ai' && isThinking) {
        message.innerHTML = `<details open><summary>Thinking… (click to expand)</summary><div class="thinking-content"></div></details><div class="answer-content"></div>`;
        addChatActions(message);
    } else if (type === 'ai') {
        const htmlContent = parseMarkdown(text);
        message.innerHTML = htmlContent;
        addChatActions(message);
        // Add click handlers for Ask Mooncow hyperlinks
        message.querySelectorAll('.ask-mooncow-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const question = decodeURIComponent(link.dataset.question).replace(/\+/g, ' ');
                if (followupInput) {
                    followupInput.value = question;
                    const sendEvent = new Event('keydown');
                    sendEvent.key = 'Enter';
                    followupInput.dispatchEvent(sendEvent);
                }
            });
        });
    } else {
        message.textContent = text;
    }
    container.appendChild(message);
    container.scrollTop = container.scrollHeight;
    return message;
}

// Replace calls to browser.runtime.sendMessage for AI completion with streaming start
// Note: we patch only inside activateAIChat and follow-ups where thinkingEl is created

// --- Small improvement: Always focus follow-up input when chat opens ---
function focusFollowupInput() {
    if (followupInput && typeof followupInput.focus === 'function') {
        // Use requestAnimationFrame for best reliability
        requestAnimationFrame(() => followupInput.focus());
    }
}
