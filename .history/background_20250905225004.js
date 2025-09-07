async function getSuggestions(query) {
  if (!query) return [];
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data[1] || [];
  } catch (error) {
    console.error("Failed to fetch suggestions:", error);
    return [];
  }
}

// Listen for messages from content scripts
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "searchTabs") {
        browser.tabs.query({}).then(tabs => {
            const now = Date.now();
            const scoredTabs = tabs.map(tab => {
                const lastAccessed = tab.lastAccessed || now;
                const age = (now - lastAccessed) / (1000 * 3600 * 24); // age in days
                // Super simple scoring: recency is king
                const score = 100 * Math.pow(0.9, age);
                return { ...tab, score };
            });
            // Sort by score, most recent first
            scoredTabs.sort((a, b) => b.score - a.score);
            sendResponse(scoredTabs);
        });
        return true;
    }

    // New, smarter history search. Returns individual pages.
    if (message.action === "searchHistory") {
        browser.history.search({text: message.query, maxResults: 100, startTime: 0})
            .then(historyItems => {
                sendResponse(historyItems.map(item => ({
                    type: 'history',
                    id: item.id,
                    url: item.url,
                    title: item.title,
                    lastVisitTime: item.lastVisitTime,
                    visitCount: item.visitCount,
                    typedCount: item.typedCount
                })));
            })
            .catch(e => {
                console.error("History search failed:", e);
                sendResponse([]);
            });
        return true;
    }

    // Aggregate recent history (last 14 days) by domain for autofill index
    if (message.action === "getRecentHistoryIndex") {
        const now = Date.now();
        const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
        const startTime = now - TWO_WEEKS_MS;
        // Empty text fetches everything in the period; cap results for performance
        browser.history.search({ text: "", maxResults: 5000, startTime })
            .then(historyItems => {
                const map = new Map();
                for (const item of historyItems) {
                    if (!item.url) continue;
                    let hostname;
                    try {
                        hostname = new URL(item.url).hostname.toLowerCase().replace(/^www\./, '');
                    } catch (_) { continue; }
                    const prev = map.get(hostname) || { domain: hostname, visitCount: 0, typedCount: 0, lastVisitTime: 0, pages: 0, daysSet: new Set() };
                    prev.visitCount += item.visitCount || 0;
                    prev.typedCount += item.typedCount || 0;
                    prev.lastVisitTime = Math.max(prev.lastVisitTime, item.lastVisitTime || 0);
                    prev.pages += 1;
                    if (item.lastVisitTime) {
                        const day = Math.floor((item.lastVisitTime - startTime) / (24 * 60 * 60 * 1000));
                        prev.daysSet.add(day);
                    }
                    map.set(hostname, prev);
                }
                const results = Array.from(map.values()).map(v => ({
                    domain: v.domain,
                    visitCount: v.visitCount,
                    typedCount: v.typedCount,
                    lastVisitTime: v.lastVisitTime,
                    pages: v.pages,
                    daysActive: v.daysSet.size
                }));
                sendResponse(results);
            })
            .catch(e => {
                console.error("Recent history index failed:", e);
                sendResponse([]);
            });
        return true;
    }

    // New bookmark search.
    if (message.action === "searchBookmarks") {
        browser.bookmarks.search(message.query)
            .then(bookmarkItems => {
                sendResponse(bookmarkItems.map(item => ({
                    type: 'bookmark',
                    id: item.id,
                    url: item.url,
                    title: item.title,
                    dateAdded: item.dateAdded
                })));
            })
            .catch(e => {
                console.error("Bookmark search failed:", e);
                sendResponse([]);
            });
        return true;
    }

    if (message.action === "switchToTab") {
        browser.windows.update(message.windowId, { focused: true });
        browser.tabs.update(message.tabId, { active: true });
        return false;
    }

    if (message.action === "createTab") {
        browser.tabs.create({ url: message.url, active: true });
        return false;
    }
    
    if (message.action === "open_options") {
        browser.runtime.openOptionsPage();
        return false;
    }

    if (message.action === 'getCerebrasCompletion') {
        if (typeof getCerebrasCompletion === 'function') {
            getCerebrasCompletion(message.messages, message.options || {})
                .then(response => sendResponse({ status: 'success', content: response }))
                .catch(error => {
                    console.error('[Background] Cerebras API call failed:', error);
                    sendResponse({ status: 'error', error: error.message });
                });
        } else {
            console.error('[Background] getCerebrasCompletion function not found!');
            sendResponse({ status: 'error', error: 'Chat function not available.' });
        }
        return true; // Indicates that the response is sent asynchronously
    }

    if (message.action === 'getGoogleCompletion') {
        if (typeof getGoogleCompletion === 'function') {
            getGoogleCompletion(message.messages, message.options || {})
                .then(response => sendResponse({ status: 'success', content: response }))
                .catch(error => {
                    console.error('[Background] Google API call failed:', error);
                    sendResponse({ status: 'error', error: error.message });
                });
        } else {
            console.error('[Background] getGoogleCompletion function not found!');
            sendResponse({ status: 'error', error: 'Google AI function not available.' });
        }
        return true; // Indicates that the response is sent asynchronously
    }

    // Streaming handlers
    if (message.action === 'streamGoogleCompletion') {
        const tabId = sender.tab.id;
        (async () => {
            try {
                const gen = streamGoogleCompletion(message.messages, message.options || {});
                for await (const token of gen) {
                    browser.tabs.sendMessage(tabId, { streamId: message.streamId, token });
                }
                browser.tabs.sendMessage(tabId, { streamId: message.streamId, done: true });
            } catch (err) {
                browser.tabs.sendMessage(tabId, { streamId: message.streamId, error: err.message || 'stream error' });
            }
        })();
        sendResponse({ status: 'streaming' });
        return true;
    }

    if (message.action === 'streamCerebrasCompletion') {
        const tabId = sender.tab.id;
        (async () => {
            try {
                const gen = streamCerebrasCompletion(message.messages, message.options || {});
                for await (const token of gen) {
                    browser.tabs.sendMessage(tabId, { streamId: message.streamId, token });
                }
                browser.tabs.sendMessage(tabId, { streamId: message.streamId, done: true });
            } catch (err) {
                browser.tabs.sendMessage(tabId, { streamId: message.streamId, error: err.message || 'stream error' });
            }
        })();
        sendResponse({ status: 'streaming' });
        return true;
    }

    // --------------------------------------------------
    // Grab page text from the active tab to feed into AI
    // --------------------------------------------------
    if (message.action === 'getPageText') {
        // Prefer the tab the message came from (iframe inside the tab)
        const tabId = sender.tab && sender.tab.id;

        const targetTabIdPromise = tabId ? Promise.resolve(tabId) : browser.tabs.query({ active: true, currentWindow: true }).then(tabs => tabs[0]?.id);

        targetTabIdPromise.then(id => {
            if (typeof id !== 'number') {
                sendResponse({ text: '' });
                return;
            }

            browser.tabs.sendMessage(id, { action: 'extractPageText' })
                .then(res => sendResponse(res))
                .catch(err => {
                    console.error('[Background] Failed to retrieve page text:', err);
                    sendResponse({ text: '' });
                });
        });
        return true; // Keep channel open for async reply
    }
}); 
