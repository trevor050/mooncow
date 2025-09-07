// Registry to expose tools in OpenAI/Cerebras function-calling format.
// Loaded in the background context before chat.js.

// Expect tools to attach themselves to the global (self) scope
// Build registry (filter out undefined)
const toolRegistry = [ self.MultiSourceSearchTool ].filter(Boolean);
const openAITools = toolRegistry.map(t => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.parameters, strict: true }
}));

async function executeToolCall({ name, arguments: argsJson }) {
  const tool = toolRegistry.find(t => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  let args = {};
  try { args = argsJson ? JSON.parse(argsJson) : {}; } catch (_) {}
  try {
    return await tool.execute(args);
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}

// Expose on global for fallback (non-module contexts)
self.toolRegistry = toolRegistry;
self.openAITools = openAITools;
self.executeToolCall = executeToolCall;

// ES module exports (MV3 background type:module)
export { openAITools, executeToolCall };
