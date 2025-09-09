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

// Truncate fetch text() outputs to 50k chars to avoid huge payloads
(function installFetchTextTruncation() {
    try {
        if (typeof Response === 'undefined' || Response.prototype.__mooncow_trunc_installed) return;
        const origText = Response.prototype.text;
        Response.prototype.fullText = function() { return origText.call(this); };
        Response.prototype.text = async function() {
            const s = await origText.call(this);
            if (typeof s !== 'string') return s;
            const MAX = 50000;
            if (s.length <= MAX) return s;
            return s.slice(0, MAX) + '\n... [truncated; there is more text. If you would like to read it use the Jina Reader tool]';
        };
        Response.prototype.__mooncow_trunc_installed = true;
    } catch (e) {
        console.warn('[Mooncow] Could not install fetch text truncation (background):', e);
    }
})();

// Listen for messages from content scripts
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "searchTabs") {
        browser.tabs.query({}).then(tabs => {
            const now = Date.now();
            // Return a sanitized copy to avoid "dead object" issues in content contexts
            const scoredTabs = tabs.map(tab => {
                const lastAccessed = tab.lastAccessed || now;
                const age = (now - lastAccessed) / (1000 * 3600 * 24);
                const score = 100 * Math.pow(0.9, age);
                return {
                    id: tab.id,
                    windowId: tab.windowId,
                    url: tab.url || tab.pendingUrl || '',
                    title: tab.title || '',
                    active: Boolean(tab.active),
                    pinned: Boolean(tab.pinned),
                    discarded: Boolean(tab.discarded),
                    hidden: Boolean(tab.hidden),
                    lastAccessed,
                    score
                };
            }).sort((a, b) => b.score - a.score);
            sendResponse(scoredTabs);
        }).catch(err => { console.warn('[Mooncow] searchTabs failed:', err); sendResponse([]); });
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
        const active = message.background ? false : true;
        browser.tabs.create({ url: message.url, active });
        return false;
    }
    
    if (message.action === "navigateCurrentTab") {
        const targetTabId = sender && sender.tab && sender.tab.id;
        if (typeof targetTabId === 'number') {
            browser.tabs.update(targetTabId, { url: message.url });
        } else {
            // Fallback: open a new tab if we don't know the sender tab
            browser.tabs.create({ url: message.url, active: true });
        }
        return false;
    }
    
    if (message.action === 'getActiveTabInfo') {
        const targetTabIdPromise = sender && sender.tab && sender.tab.id
            ? Promise.resolve(sender.tab.id)
            : browser.tabs.query({ active: true, currentWindow: true }).then(tabs => tabs[0]?.id);
        targetTabIdPromise.then(id => {
            if (typeof id !== 'number') { sendResponse({}); return; }
            browser.tabs.get(id).then(tab => sendResponse({ id: tab.id, url: tab.url || tab.pendingUrl || '', title: tab.title || '' }))
                .catch(() => sendResponse({}));
        });
        return true;
    }

    if (message.action === 'tabAction') {
        const sub = message.subaction;
        const hard = message.hard === true;
        const getTab = sender && sender.tab && sender.tab.id ? Promise.resolve(sender.tab.id) : browser.tabs.query({ active: true, currentWindow: true }).then(t => t[0]?.id);
        getTab.then(id => {
            if (typeof id !== 'number') { sendResponse({ ok: false }); return; }
            switch (sub) {
                case 'duplicate': browser.tabs.duplicate(id); break;
                case 'reload': browser.tabs.reload(id, { bypassCache: hard }); break;
                case 'back': browser.tabs.goBack(id).catch(() => {}); break;
                case 'forward': browser.tabs.goForward(id).catch(() => {}); break;
                case 'pin': browser.tabs.update(id, { pinned: true }); break;
                case 'unpin': browser.tabs.update(id, { pinned: false }); break;
                case 'mute': browser.tabs.update(id, { muted: true }); break;
                case 'unmute': browser.tabs.update(id, { muted: false }); break;
                case 'close': browser.tabs.remove(id); break;
                case 'move_to_new_window':
                    browser.tabs.get(id).then(tab => {
                        browser.windows.create({ tabId: id, focused: true });
                    }).catch(() => {});
                    break;
                case 'new_tab':
                    browser.tabs.create({ url: 'about:newtab' });
                    break;
                case 'new_window':
                    browser.windows.create({});
                    break;
            }
            sendResponse({ ok: true });
        });
        return true;
    }

    if (message.action === 'bookmarkCurrentPage') {
        const getTab = sender && sender.tab && sender.tab.id ? Promise.resolve(sender.tab.id) : browser.tabs.query({ active: true, currentWindow: true }).then(t => t[0]?.id);
        getTab.then(id => {
            if (typeof id !== 'number') { sendResponse({ ok: false }); return; }
            browser.tabs.get(id).then(tab => {
                browser.bookmarks.create({ title: tab.title || tab.url || 'Bookmark', url: tab.url || '' })
                    .then(() => sendResponse({ ok: true }))
                    .catch(() => sendResponse({ ok: false }));
            }).catch(() => sendResponse({ ok: false }));
        });
        return true;
    }

    if (message.action === 'captureScreenshot') {
        // Try capture from the sender's window first; fall back to current active
        const getWinId = sender && sender.tab && sender.tab.windowId
            ? Promise.resolve(sender.tab.windowId)
            : browser.windows.getCurrent().then(w => w && w.id);
        getWinId.then(windowId => {
            if (typeof windowId !== 'number') { sendResponse({ ok: false }); return; }
            browser.tabs.captureVisibleTab(windowId, { format: 'png' })
                .then(dataUrl => browser.downloads.download({ url: dataUrl, filename: 'mooncow-screenshot.png', saveAs: false }))
                .then(() => sendResponse({ ok: true }))
                .catch(err => { console.warn('screenshot failed', err); sendResponse({ ok: false, error: String(err) }); });
        }).catch(err => { console.warn('captureScreenshot winId failed', err); sendResponse({ ok: false }); });
        return true;
    }
    
    if (message.action === "open_options") {
        browser.runtime.openOptionsPage();
        return false;
    }

    if (message.action === 'getCerebrasCompletion') {
        console.log('[Mooncow] getCerebrasCompletion request received:', {
            hasMessages: Array.isArray(message.messages),
            msgCount: Array.isArray(message.messages) ? message.messages.length : 0,
            options: message.options || {}
        });
        if (typeof getCerebrasCompletion === 'function') {
            getCerebrasCompletion(message.messages, message.options || {})
                .then(response => {
                    try {
                        console.log('[Mooncow] getCerebrasCompletion response (preview):', String(response).slice(0, 280));
                    } catch (_) {}
                    sendResponse({ status: 'success', content: response });
                })
                .catch(error => {
                    console.error('[Background] Cerebras API call failed:', error);
                    sendResponse({ status: 'error', error: error.message });
                })
                .finally(() => {
                    console.log('[Mooncow] getCerebrasCompletion finished');
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
        const tabId = sender && sender.tab && sender.tab.id;
        console.log('[Mooncow] streamCerebrasCompletion request received:', {
            hasMessages: Array.isArray(message.messages),
            msgCount: Array.isArray(message.messages) ? message.messages.length : 0,
            options: message.options || {},
            streamId: message.streamId
        });
        // Broadcast a debug start line to either the tab or extension page
        const debugStart = { streamId: message.streamId, debug: 'streamCerebrasCompletion started' };
        if (typeof tabId === 'number') browser.tabs.sendMessage(tabId, debugStart); else browser.runtime.sendMessage(debugStart);
        (async () => {
            try {
                const gen = streamCerebrasCompletion(message.messages, message.options || {});
                for await (const token of gen) {
                    if (typeof tabId === 'number') {
                        browser.tabs.sendMessage(tabId, { streamId: message.streamId, token });
                    } else {
                        // Fallback to runtime broadcast for extension pages (e.g., search.html)
                        browser.runtime.sendMessage({ streamId: message.streamId, token });
                    }
                }
                if (typeof tabId === 'number') {
                    browser.tabs.sendMessage(tabId, { streamId: message.streamId, done: true });
                } else {
                    browser.runtime.sendMessage({ streamId: message.streamId, done: true });
                }
                console.log('[Mooncow] streamCerebrasCompletion done for streamId:', message.streamId);
                const debugDone = { streamId: message.streamId, debug: 'streamCerebrasCompletion done' };
                if (typeof tabId === 'number') browser.tabs.sendMessage(tabId, debugDone); else browser.runtime.sendMessage(debugDone);
            } catch (err) {
                if (typeof tabId === 'number') {
                    browser.tabs.sendMessage(tabId, { streamId: message.streamId, error: err.message || 'stream error' });
                } else {
                    browser.runtime.sendMessage({ streamId: message.streamId, error: err.message || 'stream error' });
                }
                console.error('[Mooncow] streamCerebrasCompletion error for streamId:', message.streamId, err);
                const debugErr = { streamId: message.streamId, debug: `streamCerebrasCompletion error: ${err && err.message ? err.message : String(err)}` };
                if (typeof tabId === 'number') browser.tabs.sendMessage(tabId, debugErr); else browser.runtime.sendMessage(debugErr);
            }
        })();
        sendResponse({ status: 'streaming' });
        return true;
    }

    // --------------------------------------------------
    // Grab page text from the active tab to feed into AI
    // --------------------------------------------------
    if (message.action === 'getPageText') {
console.log('[Mooncow] background.js loaded');
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
