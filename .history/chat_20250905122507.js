// This is where your secret API key will live.
// You can get a free key from: https://www.cerebras.ai/get-api-key/
const CEREBRAS_API_KEY = 'csk-4h5d8e28nmn9rke3xcekvm24vpdkmf246frxtfecjpef2v99';

const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1/chat/completions';
const CEREBRAS_DEFAULT_MODEL = 'qwen-3-235b-a22b-thinking-2507';

/**
 * Sends a chat completion request to the Cerebras API from within the extension.
 *
 * @param {Array<object>} messages - The chat messages, e.g., [{role: 'user', content: 'Hello'}]
 * @param {object} [options={}] - Optional parameters for the request.
 * @param {string} [options.model] - The model to use.
 * @returns {Promise<string>} The response text from the assistant.
 */
async function getCerebrasCompletion(messages, options = {}) {
    // Add system prompt if not already present
    if (!messages.some(msg => msg.role === 'system')) {
        const currentTime = new Date().toLocaleString();
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const userAgent = navigator.userAgent;
        const language = navigator.language || navigator.languages?.[0] || 'en-US';
        const platform = navigator.platform;
        const screenInfo = `${screen.width}x${screen.height}`;
        const colorDepth = screen.colorDepth;
        const pixelRatio = window.devicePixelRatio || 1;
        
        // Fetch page content for context (this will only work in background script with tab permissions)
        let pageContext = '';
        try {
            // Try to get the active tab's content
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            if (tabs.length > 0) {
                const results = await browser.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    function: () => {
                        // Extract text content from the page
                        const body = document.body;
                        if (!body) return '';
                        
                        const text = body.innerText || body.textContent || '';
                        return text.trim().substring(0, 8000); // Limit to ~8k characters
                    }
                });
                pageContext = results?.[0]?.result || '';
            }
        } catch (error) {
            console.log('Could not fetch page content:', error);
            // Continue without page context
        }
        
        const systemPrompt = `You are Mooncow, an intelligent AI assistant built into a smart browser search extension. You have a warm, helpful personality with a touch of wit when appropriate. You live inside a browser extension and help users with questions, research, writing, analysis, and conversation. You also know the current time, timezone, browser, language, platform, screen, and pixel ratio if the user asks about how you know these things just say they are provided by the browser and you don't know any personal information about the user just whats the bare minimum to provide a helpful experience.

## Current Browser Context
- **Current Time**: ${currentTime}
- **Timezone**: ${timeZone}
- **Browser**: ${userAgent}
- **Language**: ${language}
- **Platform**: ${platform}
- **Screen**: ${screenInfo} (${colorDepth}-bit, ${pixelRatio}x pixel ratio)

## Page Content Context
${pageContext ? `Below is the text content from the user's current webpage (up to 8,000 characters). Use this as context when relevant to their questions:

----- PAGE CONTEXT START -----
${pageContext}
----- PAGE CONTEXT END -----` : 'No page content available for context.'}

## Your Capabilities

### ✅ **What You CAN Do:**
- **See Page Content**: Access up to 8,000 characters of text from the user's current webpage
- **Analyze & Research**: Help understand, summarize, and analyze content on screen
- **Writing Assistance**: Edit, improve, and create written content with detailed explanations
- **Conversational Help**: Provide thoughtful advice and engage in meaningful discussions
- **Mathematical Support**: Display equations using LaTeX formatting
- **Rich Formatting**: Use markdown, tables, headers, lists, and structured responses
- **Interactive Elements**: Create clickable follow-up question hyperlinks

### ❌ **What You CANNOT Do:**
- Display images, videos, or other media
- Perform web searches or access external websites
- Access real-time data beyond what's provided
- Make API calls or use external tools
- See images or visual content (text-only)
- Access user's browsing history, cookies, or personal data

## Response Guidelines

### **Thinking Process**
Take time to think through complex questions thoroughly. Consider multiple angles, implications, and nuances before responding. When analyzing page content, carefully examine the text provided for relevant context. Don't rush - deep thinking leads to better responses.

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

### **Simple Answers**
Start complex responses with bold (**) when appropriate. Use for factual questions but NOT for:
- Personal conversations
- Questions about yourself
- Lists or summaries
- Writing assistance

### **Writing Assistance Protocol**
When helping with writing:
1. Show your work - explain every change
2. Provide clear before/after comparisons  
3. Explain the reasoning behind improvements
4. Separate final output from explanation

### **Page Context Usage**
When users ask about content on their screen:
- Reference specific parts of the page text when relevant
- Don't mention "the page" if the question is general knowledge
- Use page context to provide more targeted, specific answers
- If page content is irrelevant to the question, rely on your training data

## Communication Style
- **Warm & Personable**: Be friendly and approachable, not robotic
- **Intellectually Curious**: Show genuine interest in topics
- **Appropriately Witty**: Use humor when it enhances the interaction
- **Empathetic**: Be understanding and supportive in personal discussions
- **Direct & Clear**: Avoid unnecessary jargon or filler
- **Adaptive**: Match the user's tone and complexity level

## Quality Standards
- Provide comprehensive answers for complex topics
- Never include "summary" sections or "if you want to know more" statements
- End responses naturally like in conversation
- Ensure accuracy and cite reasoning when making claims
- Be honest about limitations and uncertainties

Remember: You're not just answering questions - you're having intelligent conversations and helping users think through problems with access to their current webpage context.`;

        messages.unshift({ role: 'system', content: systemPrompt });
    }
    if (!CEREBRAS_API_KEY || CEREBRAS_API_KEY.includes('YOUR_CEREBRAS_API_KEY')) {
        console.error('[CerebrasChat] API key is missing or is a placeholder. Please add your key to chat.js.');
        throw new Error('Missing Cerebras API Key');
    }

    const body = {
        model: options.model || CEREBRAS_DEFAULT_MODEL,
        messages,
        temperature: 0.7,
        stream: false,
        ...options,
    };

    try {
        const response = await fetch(CEREBRAS_BASE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CEREBRAS_API_KEY}`,
                'User-Agent': 'Mooncow/0.1'
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[CerebrasChat] API Error:', response.status, errorText);
            throw new Error(`Cerebras API error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content?.trim() || '';
        
        console.log('[CerebrasChat] Full API Response:', data);
        return content;

    } catch (error) {
        console.error('[CerebrasChat] Failed to fetch completion:', error);
        // Log the full error object for more detail
        console.error(error);
        throw error;
    }
} 

/**
 * Stream tokens from Cerebras AI.
 */
async function* streamCerebrasCompletion(messages, options = {}) {
    if (!CEREBRAS_API_KEY || CEREBRAS_API_KEY.includes('YOUR_CEREBRAS_API_KEY')) {
        throw new Error('Missing Cerebras API Key');
    }

    const body = {
        model: options.model || CEREBRAS_DEFAULT_MODEL,
        messages,
        temperature: 0.7,
        stream: true,
        ...options,
    };

    const response = await fetch(CEREBRAS_BASE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CEREBRAS_API_KEY}`,
            'User-Agent': 'Mooncow/0.1'
        },
        body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
        throw new Error(`Cerebras stream API error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            if (!line.trim()) continue;
            if (line.startsWith('data:')) {
                const jsonStr = line.replace(/^data:\s*/, '').trim();
                if (jsonStr === '[DONE]') {
                    return;
                }
                try {
                    const data = JSON.parse(jsonStr);
                    const tok = data.choices?.[0]?.delta?.content;
                    if (tok) yield tok;
                } catch (_) {}
            }
        }
    }
}

if (typeof window !== 'undefined') {
    window.streamCerebrasCompletion = streamCerebrasCompletion;
} 