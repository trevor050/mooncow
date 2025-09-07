// Registry to expose tools in OpenAI/Cerebras function-calling format.
// Loaded in the background context before chat.js.

// Expect tools to attach themselves to the global (self) scope
// Keep an array of tools with execute functions
self.toolRegistry = [ self.MultiSourceSearchTool ].filter(Boolean);

// OpenAI-style tool descriptors for chat.completions
self.openAITools = self.toolRegistry.map(t => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters, strict: true }
}));

// Execute a tool call from the model
self.executeToolCall = async function({ name, arguments: argsJson }) {
  const tool = (self.toolRegistry || []).find(t => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  let args = {};
  try { args = argsJson ? JSON.parse(argsJson) : {}; } catch (_) {}
  try {
    return await tool.execute(args);
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
}
