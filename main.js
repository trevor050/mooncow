// Arc Max Clone for Zen Browser
// Brings all the Arc Max AI goodness to Zen via OpenRouter

console.log('🌙 Arc Max Clone loading...');

// Access Zen preferences (assuming this is how Zen exposes prefs)
const getPrefs = () => {
  try {
    return typeof zenPrefs !== 'undefined' ? zenPrefs() : {};
  } catch (e) {
    console.warn('Could not access zenPrefs, using defaults');
    return {};
  }
};

const prefs = getPrefs();
const apiKey = () => prefs.openrouter_api_key || '';
const model = () => prefs.model || 'openai/gpt-4o';

// Core chat function - this is where the magic happens
async function chat(userPrompt, systemPrompt = "You are a helpful assistant.") {
  if (!apiKey()) {
    showToast("⚠️ Set your OpenRouter API key in mod preferences first!");
    return "Please configure your OpenRouter API key in the mod preferences.";
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey()}`,
        "HTTP-Referer": "https://zen-browser.app",
        "X-Title": "Arc Max Clone for Zen"
      },
      body: JSON.stringify({
        model: model(),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "No response received 🤷";
  } catch (error) {
    console.error('Chat API error:', error);
    showToast(`API Error: ${error.message}`);
    return `Error: ${error.message}`;
  }
}

/* ---------- Feature: Ask on Page (Cmd/Ctrl+F Override) ---------- */
function initAskOnPage() {
  if (!prefs.enable_ask_on_page) return;
  
  console.log('🔍 Initializing Ask on Page...');
  
  // Override Cmd/Ctrl+F to show our AI search instead
  document.addEventListener("keydown", async (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      e.preventDefault();
      e.stopPropagation();
      
      const question = prompt("Ask about this page:");
      if (!question) return;
      
      showOverlay("Thinking about your question...", true);
      
      // Get page content but limit it to avoid token limits
      const pageText = document.body.innerText.slice(0, 30000);
      const pageTitle = document.title;
      const pageUrl = window.location.href;
      
      const systemPrompt = `You are an expert at analyzing web pages and answering questions about their content. 
      Be concise but thorough. If the answer isn't in the page content, say so clearly.`;
      
      const userPrompt = `PAGE TITLE: ${pageTitle}
PAGE URL: ${pageUrl}

PAGE CONTENT:
${pageText}

QUESTION: ${question}

Please answer the question based only on the information provided above.`;

      const answer = await chat(userPrompt, systemPrompt);
      showOverlay(answer);
    }
  });
}

/* ---------- Feature: 5-second Previews (Shift+Hover) ---------- */
function initLinkPreviews() {
  if (!prefs.enable_link_previews) return;
  
  console.log('🔗 Initializing Link Previews...');
  
  let hoverTimer;
  let currentTooltip;
  
  document.addEventListener("mouseover", (e) => {
    const link = e.target.closest("a[href]");
    if (!link || !e.shiftKey) return;
    
    // Clear any existing timer/tooltip
    clearTimeout(hoverTimer);
    if (currentTooltip) currentTooltip.remove();
    
    hoverTimer = setTimeout(async () => {
      currentTooltip = makeTooltip(e.pageX, e.pageY, "Loading preview...");
      
      try {
        // Try to fetch the page (might fail due to CORS)
        const response = await fetch(link.href, { 
          mode: "cors",
          headers: { "User-Agent": "Arc Max Clone Bot" }
        });
        
        if (!response.ok) throw new Error("Could not fetch page");
        
        const html = await response.text();
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // Extract meaningful content
        const title = tempDiv.querySelector('title')?.textContent || '';
        const description = tempDiv.querySelector('meta[name="description"]')?.content || '';
        const text = tempDiv.innerText.slice(0, 2000);
        
        const summary = await chat(
          `Summarize this webpage in one clear sentence:\n\nTitle: ${title}\nDescription: ${description}\nContent: ${text}`,
          "You are an expert at creating concise, informative summaries."
        );
        
        currentTooltip.textContent = summary;
      } catch (error) {
        currentTooltip.textContent = `Preview unavailable: ${error.message}`;
      }
    }, 500);
  });
  
  document.addEventListener("mouseout", (e) => {
    if (!e.shiftKey) {
      clearTimeout(hoverTimer);
      if (currentTooltip) {
        setTimeout(() => currentTooltip?.remove(), 100);
      }
    }
  });
  
  // Clean up on shift release
  document.addEventListener("keyup", (e) => {
    if (e.key === "Shift") {
      clearTimeout(hoverTimer);
      if (currentTooltip) currentTooltip.remove();
    }
  });
}

/* ---------- Feature: ChatGPT in Command Bar (Cmd+Option+G) ---------- */
function initCommandBarChat() {
  console.log('💬 Initializing Command Bar Chat...');
  
  document.addEventListener("keydown", (e) => {
    if (e.metaKey && e.altKey && e.key === "g") {
      e.preventDefault();
      showChatOverlay();
    }
  });
}

/* ---------- Feature: Instant Links (Shift+Enter in search) ---------- */
function initInstantLinks() {
  if (!prefs.enable_instant_links) return;
  
  console.log('⚡ Initializing Instant Links...');
  
  // Look for search inputs and add our handler
  document.addEventListener("keydown", async (e) => {
    if (e.shiftKey && e.key === "Enter") {
      const activeElement = document.activeElement;
      
      // Check if we're in a search box
      if (activeElement && (
        activeElement.type === "search" ||
        activeElement.name?.toLowerCase().includes("search") ||
        activeElement.placeholder?.toLowerCase().includes("search") ||
        activeElement.closest('[role="search"]')
      )) {
        e.preventDefault();
        const query = activeElement.value.trim();
        if (!query) return;
        
        showToast("🔍 Finding top result...");
        
        // Use DuckDuckGo Instant Answer API for I'm Feeling Lucky
        try {
          const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`;
          const response = await fetch(searchUrl);
          const data = await response.json();
          
          // If we get a redirect, use that, otherwise search normally
          if (data.Redirect) {
            window.open(data.Redirect, '_blank');
          } else {
            // Fallback to Google I'm Feeling Lucky
            window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}&btnI=1`, '_blank');
          }
        } catch (error) {
          // Fallback to regular Google search
          window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
        }
      }
    }
  });
}

/* ---------- Browser Extension Features (if available) ---------- */
function initBrowserFeatures() {
  // Check if we have browser extension APIs available
  if (typeof browser === 'undefined' && typeof chrome === 'undefined') {
    console.log('🌐 Browser APIs not available, skipping extension features');
    return;
  }
  
  const browserAPI = typeof browser !== 'undefined' ? browser : chrome;
  
  // Tidy Tab Titles
  if (prefs.enable_tidy_tabs && browserAPI.tabs) {
    console.log('📑 Initializing Tidy Tab Titles...');
    
    browserAPI.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (tab.pinned && changeInfo.title && changeInfo.title.length > 35) {
        try {
          const tidyTitle = await chat(
            `Shorten this tab title to under 35 characters while keeping it clear and recognizable:\n"${changeInfo.title}"`,
            "You are an expert at creating concise, clear titles."
          );
          
          if (tidyTitle && tidyTitle !== changeInfo.title) {
            browserAPI.tabs.update(tabId, { title: tidyTitle });
          }
        } catch (error) {
          console.error('Error tidying tab title:', error);
        }
      }
    });
  }
  
  // Tidy Downloads
  if (prefs.enable_tidy_downloads && browserAPI.downloads) {
    console.log('📥 Initializing Tidy Downloads...');
    
    browserAPI.downloads.onCreated.addListener(async (downloadItem) => {
      try {
        const newName = await chat(
          `Suggest a clearer, more organized filename for this download:\n"${downloadItem.filename}"\n\nKeep the file extension the same.`,
          "You are an expert at organizing files with clear, descriptive names."
        );
        
        if (newName && newName !== downloadItem.filename) {
          browserAPI.downloads.rename(downloadItem.id, newName);
          showToast(`📁 Renamed download to: ${newName}`);
        }
      } catch (error) {
        console.error('Error tidying download:', error);
      }
    });
  }
}

/* ---------- UI Helper Functions ---------- */
function showOverlay(text, isLoading = false) {
  // Remove any existing overlay
  const existing = document.getElementById("arc-max-overlay");
  if (existing) existing.remove();
  
  const overlay = document.createElement("div");
  overlay.id = "arc-max-overlay";
  
  const closeBtn = document.createElement("button");
  closeBtn.className = "close-btn";
  closeBtn.innerHTML = "×";
  closeBtn.onclick = () => overlay.remove();
  
  const content = document.createElement("pre");
  content.textContent = text;
  if (isLoading) content.className = "loading-dots";
  
  overlay.appendChild(closeBtn);
  overlay.appendChild(content);
  document.body.appendChild(overlay);
  
  // Auto-dismiss after 20 seconds unless it's a loading message
  if (!isLoading) {
    setTimeout(() => overlay.remove(), 20000);
  }
  
  return overlay;
}

function showChatOverlay() {
  // Remove any existing chat
  const existing = document.getElementById("arc-max-chat");
  if (existing) existing.remove();
  
  const chat = document.createElement("div");
  chat.id = "arc-max-chat";
  
  chat.innerHTML = `
    <div class="chat-header">
      <span>🤖 Arc Max Chat</span>
      <button class="close-btn" onclick="this.closest('#arc-max-chat').remove()">×</button>
    </div>
    <div class="chat-body">
      <textarea class="chat-input" placeholder="Ask me anything..." autofocus></textarea>
      <div class="chat-response" style="display: none;"></div>
    </div>
  `;
  
  document.body.appendChild(chat);
  
  const input = chat.querySelector('.chat-input');
  const response = chat.querySelector('.chat-response');
  
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const question = input.value.trim();
      if (!question) return;
      
      response.style.display = 'block';
      response.textContent = 'Thinking...';
      response.className = 'chat-response loading-dots';
      
      const answer = await chat(question, "You are a helpful assistant. Be concise but thorough.");
      
      response.className = 'chat-response';
      response.textContent = answer;
      input.value = '';
    }
  });
  
  // Focus the input
  input.focus();
}

function makeTooltip(x, y, text) {
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip-preview";
  tooltip.textContent = text;
  document.body.appendChild(tooltip);
  
  // Position tooltip, but keep it on screen
  const rect = tooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  let left = x + 12;
  let top = y + 12;
  
  // Adjust if tooltip would go off-screen
  if (left + rect.width > viewportWidth) {
    left = x - rect.width - 12;
  }
  if (top + rect.height > viewportHeight) {
    top = y - rect.height - 12;
  }
  
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  
  return tooltip;
}

function showToast(message, duration = 3000) {
  const toast = document.createElement("div");
  toast.className = "arc-max-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), duration);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

/* ---------- Initialize Everything ---------- */
function init() {
  console.log('🚀 Arc Max Clone initializing...');
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
    return;
  }
  
  try {
    initAskOnPage();
    initLinkPreviews();
    initCommandBarChat();
    initInstantLinks();
    initBrowserFeatures();
    
    showToast('🌙 Arc Max Clone loaded!');
    console.log('✅ Arc Max Clone ready!');
  } catch (error) {
    console.error('❌ Arc Max Clone initialization failed:', error);
    showToast('❌ Arc Max Clone failed to load');
  }
}

// Start the magic
init(); 