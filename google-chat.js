// Google AI implementation for Mooncow
// Get your free API key from: https://aistudio.google.com/app/apikey

let GOOGLE_API_KEY = '';
const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';

const GOOGLE_MODEL_FALLBACK_LIST = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite-preview-06-17'
];

/**
 * Executes a request to the Google AI API with a fallback mechanism for rate limiting.
 * @param {Array<object>} messages - The chat messages.
 * @param {object} options - Optional parameters.
 * @param {boolean} stream - Whether to use the streaming endpoint.
 * @returns {Promise<Response>} The fetch Response object.
 */
async function executeGoogleAIRequest(messages, options, stream = false) {
    try {
        const stored = await (typeof browser !== 'undefined' && browser.storage?.local?.get
            ? browser.storage.local.get('GOOGLE_API_KEY')
            : (typeof chrome !== 'undefined' && chrome.storage?.local?.get
                ? new Promise(res => chrome.storage.local.get('GOOGLE_API_KEY', res))
                : Promise.resolve({}))); 
        GOOGLE_API_KEY = stored?.GOOGLE_API_KEY || '';
    } catch (_) {
        GOOGLE_API_KEY = '';
    }
    if (!GOOGLE_API_KEY) {
        throw new Error('Missing Google API Key');
    }

    const convertedMessages = await convertMessagesToGoogleFormat(messages, options);
    
    // System instructions are now part of the message conversion logic
    const requestBody = {
        contents: convertedMessages,
        tools: [{ google_search: {} }],
        generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192,
            thinkingConfig: { includeThoughts: true, thinkingBudget: -1 }
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
        ]
    };

    let lastError = null;

    for (const model of GOOGLE_MODEL_FALLBACK_LIST) {
        const action = stream ? ':streamGenerateContent' : ':generateContent';
        const altParam = stream ? '&alt=sse' : '';
        const url = `${GOOGLE_BASE_URL}${model}${action}?key=${GOOGLE_API_KEY}${altParam}`;

        const headers = { 'Content-Type': 'application/json' };
        if (stream) {
            headers['Accept'] = 'text/event-stream';
        }
        
        console.log(`[GoogleChat] Attempting to call model: ${model}`);

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
            });

            if (response.status === 429) {
                console.warn(`[GoogleChat] Rate limit hit for model ${model}. Trying next model.`);
                lastError = new Error(`Rate limit exceeded for ${model}`);
                continue; // Try the next model
            }

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[GoogleChat] API Error for model ${model}:`, {
                    status: response.status,
                    statusText: response.statusText,
                    url,
                    errorText,
                    headers: Object.fromEntries(response.headers.entries())
                });
                lastError = new Error(`Google API error for ${model}: ${response.status} - ${errorText}`);
                continue; // Also try next model on other server errors, could be temporary
            }

            console.log(`[GoogleChat] Successfully connected to model: ${model}`);
            return response; // Success!

        } catch (error) {
            console.error(`[GoogleChat] Fetch failed for model ${model}:`, error);
            lastError = error;
            continue; // Network or other fetch error, try next model
        }
    }

    console.error('[GoogleChat] All models in the fallback list failed.');
    throw lastError || new Error('All Google AI models failed to respond.');
}


/**
 * Sends a chat completion request to Google's Gemini API.
 * This function now uses the fallback executor.
 * 
 * @param {Array<object>} messages - The chat messages
 * @param {object} [options={}] - Optional parameters
 * @returns {Promise<string>} The response text from the assistant
 */
async function getGoogleCompletion(messages, options = {}) {
    try {
        const response = await executeGoogleAIRequest(messages, options, false);
        const data = await response.json();
        
        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            const content = data.candidates[0].content.parts[0].text.trim();
            console.log('[GoogleChat] API Response received:', content.substring(0, 100) + '...');
            return content;
        } else {
            console.error('[GoogleChat] Unexpected response format:', data);
            throw new Error('Unexpected response format from Google API');
        }
    } catch (error) {
        console.error('[GoogleChat] Failed to get completion after all fallbacks:', error && error.stack ? error.stack : error);
        throw error;
    }
}

/**
 * Stream completion tokens from Gemini model (token-by-token)
 * This function now uses the fallback executor.
 * Returns an async generator that yields token strings.
 */
async function* streamGoogleCompletion(messages, options = {}) {
    const response = await executeGoogleAIRequest(messages, options, true);

    if (!response.body) {
        throw new Error(`Google stream API error: Response has no body.`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Stream response arrives as Server-Sent Events (one JSON per line, prefixed with "data: ")
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep the last (possibly incomplete) line for next chunk

        for (let line of lines) {
            line = line.trim();
            if (!line) continue;

            // Remove the SSE "data:" prefix if present
            if (line.startsWith('data:')) {
                line = line.slice(5).trim();
            }

            // Stream terminator
            if (line === '[DONE]') {
                return;
            }

            try {
                // Google wraps each chunk in an array, so unwrap it
                let data = JSON.parse(line);
                if (Array.isArray(data) && data.length > 0) {
                    data = data[0];
                }
                const parts = data.candidates?.[0]?.content?.parts;
                if (Array.isArray(parts)) {
                    for (const part of parts) {
                        if (part.text) {
                            if (part.thought) {
                                yield { type: 'thought', text: part.text };
                            } else {
                                yield { type: 'answer', text: part.text };
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[GoogleChat] Failed to parse stream chunk:', line, e);
            }
        }
    }
}

// expose globally
if (typeof window !== 'undefined') {
    window.streamGoogleCompletion = streamGoogleCompletion;
}

/**
 * Convert our internal message format to Google's format
 */
async function convertMessagesToGoogleFormat(messages, options = {}) {
    const converted = [];
    let screenshot = null;
    let pageSummary = null;

    const systemInstruction = {
        role: "user",
        parts: [{
            text: `You are Mooncow, an intelligent AI assistant built into a smart browser search extension. You have a warm, helpful personality with a touch of wit when appropriate. You live inside a browser extension and help users with questions, research, writing, analysis, and conversation.

## Current Browser Context
- **Current Time**: ${new Date().toLocaleString()}
- **Timezone**: ${Intl.DateTimeFormat().resolvedOptions().timeZone}
- **Browser**: ${navigator.userAgent}
- **Language**: ${navigator.language || navigator.languages?.[0] || 'en-US'}
- **Platform**: ${navigator.platform}
- **Screen**: ${screen.width}x${screen.height} (${screen.colorDepth}-bit, ${window.devicePixelRatio || 1}x pixel ratio)

## Your Capabilities

### ✅ **What You CAN Do:**
- **See Page Content**: Access text content from the user's current webpage
- **See Screenshots**: When using Google AI, you can see images of the user's screen
- **Google Search (high leverage)**: Actively use Google Search to ground claims, verify facts, and expand coverage beyond static knowledge. Prefer this when information may have changed or when breadth matters.
- **Analyze & Research**: Help understand, summarize, and analyze content on screen
- **Writing Assistance**: Edit, improve, and create written content with detailed explanations
- **Conversational Help**: Provide thoughtful advice and engage in meaningful discussions
- **Mathematical Support**: Display equations using LaTeX formatting
- **Rich Formatting**: Use markdown, tables, headers, lists, and structured responses
- **Interactive Elements**: Create clickable follow-up question hyperlinks

### ❌ **What You CANNOT Do:**
- Access real-time data beyond what's provided
- Make API calls or use external tools  
- Access user's browsing history, cookies, or personal data beyond what's shown

## Response Guidelines

### **Thinking Process**
Take time to think through complex questions thoroughly. Consider multiple angles, implications, and nuances before responding. When analyzing page content or screenshots, carefully examine all visible information for relevant context.

### **Screenshot Analysis**
When you can see a screenshot of the user's screen:
- Describe what you can see if relevant to the question
- Reference specific UI elements, text, or visual content
- Help with troubleshooting based on what's visible
- Assist with understanding visual information

### **Markdown & Formatting**
Use comprehensive markdown formatting:
- **Headers** with \`#\`, \`##\`, \`###\`, \`####\` for structure
- **Tables** for organized data (max 5 columns)
- **Lists** (bulleted and numbered) with proper nesting
- **Code blocks** with \`\`\`language syntax
- **LaTeX equations**: 
  - Inline: \`<latex>E = mc^2</latex>\`
  - Block: \`\`\`latex\\n\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}\\n\`\`\`

### **Interactive Hyperlinks**
Create clickable follow-up questions using: \`[topic](ask://ask/specific-follow-up-question)\`

Example: "Machine learning involves training [algorithms](ask://ask/How+do+machine+learning+algorithms+learn) on data."

### **Communication Style**
- **Warm & Personable**: Be friendly and approachable, not robotic
- **Intellectually Curious**: Show genuine interest in topics
- **Appropriately Witty**: Use humor when it enhances the interaction
- **Empathetic**: Be understanding and supportive in personal discussions
- **Direct & Clear**: Avoid unnecessary jargon or filler
- **Adaptive**: Match the user's tone and complexity level

Remember: You're not just answering questions - you're having intelligent conversations and helping users think through problems with access to both text and visual context. When accuracy or recency matters, lean on Google Search first to validate and collect diverse, reputable sources.`
        }]
    };
    
    converted.push(systemInstruction);

    // Capture screenshot if requested
    if (options.includeScreenshot) {
        try {
            screenshot = await captureVisibleTab();
        } catch (error) {
            console.warn('[GoogleChat] Failed to capture screenshot:', error);
        }
    }

    // Capture full-page PDF if requested
    if (options.includePdf) {
        try {
            pageSummary = await capturePageSummary();
        } catch (error) {
            console.warn('[GoogleChat] Failed to capture page summary:', error);
        }
    }

    for (const message of messages) {
        if (message.role === 'system') {
            // System messages are handled separately in Google's format
            continue;
        }

        const googleMessage = {
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: []
        };
        // For FIRST user message attach media before text
        if (message.role === 'user' && converted.length === 0) {
            if (screenshot) {
                googleMessage.parts.push({
                    inlineData: {
                        mimeType: 'image/png',
                        data: screenshot
                    }
                });
            }
            if (pageSummary) {
                // Attach page summary as text before user prompt
                googleMessage.parts.push({ text: pageSummary });
            }
        }

        // Add text content (always last)
        if (message.content) {
            googleMessage.parts.push({ text: message.content });
        }

        converted.push(googleMessage);
    }

    return converted;
}

/**
 * Capture screenshot of the current visible tab
 */
async function captureVisibleTab() {
    try {
        // Get the active tab
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) {
            throw new Error('No active tab found');
        }

        // Capture the visible area of the tab
        const dataUrl = await browser.tabs.captureVisibleTab(tabs[0].windowId, { format: 'png' });
        
        // Convert data URL to base64 (remove the data:image/png;base64, prefix)
        const base64Data = dataUrl.split(',')[1];
        
        return base64Data;
    } catch (error) {
        console.error('[GoogleChat] Failed to capture screenshot:', error);
        throw error;
    }
}

/**
 * Capture full-page content as structured JSON and return base-64 string
 * Cross-browser compatible alternative to Chrome's pageCapture API
 */
async function capturePageSummary() {
    try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) throw new Error('No active tab');
 
        // Inject script to capture page title, URL, and visible text (truncated)
        const result = await browser.tabs.executeScript(tabs[0].id, {
             code: `
                 ({
                    title: document.title,
                    url: window.location.href,
                    text: (document.body.innerText || '').slice(0, 8000)
                 });
              `
          });
 
        if (result && result[0]) {
            const { title, url, text } = result[0];
            const summary = `PAGE_URL: ${url}\nTITLE: ${title}\nCONTENT_SNIPPET:\n${text}`;
            return summary;
        }
         
        return null;
    } catch (err) {
        console.error('[GoogleChat] Page summary capture failed:', err);
        return null;
    }
} 