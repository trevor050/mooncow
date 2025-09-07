// Cerebras Documentation Search Tool
// This tool searches the Cerebras Inference knowledge base for technical information

self.CerebrasSearchTool = {
  name: "cerebras_search",
  description: "Search Cerebras Inference documentation for technical information, API references, guides, and implementation details. Best for questions about Cerebras AI services, APIs, models, tool calling, and development guidance.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query for Cerebras documentation. Should be specific technical terms or concepts."
      }
    },
    required: ["query"]
  },
  async execute({ query }) {
    if (!query || typeof query !== 'string') {
      return { error: 'Query parameter is required and must be a string' };
    }

    try {
      // This will be replaced by the actual MCP call when available
      // For now, return a placeholder that indicates the tool is available
      const searchResults = {
        query: query,
        results: [
          {
            title: "Cerebras Tool Use Documentation",
            link: "https://inference-docs.cerebras.ai/capabilities/tool-use",
            content: "The Cerebras Inference SDK supports tool use, enabling programmatic execution of specific tasks. Ensure 'strict': True is set in the function object. Use parallel_tool_calls=False for some models."
          },
          {
            title: "Chat Completions API",
            link: "https://inference-docs.cerebras.ai/api-reference/chat-completions", 
            content: "Cerebras supports OpenAI-compatible chat completions with tools, tool_choice (auto/none/required), and structured outputs."
          }
        ],
        meta: {
          source: "cerebras-docs",
          timestamp: new Date().toISOString()
        }
      };

      return searchResults;
    } catch (error) {
      return { 
        error: `Cerebras search failed: ${error.message}`,
        query: query 
      };
    }
  }
};
