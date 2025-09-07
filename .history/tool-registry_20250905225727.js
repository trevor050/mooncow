// Registry to expose tools in OpenAI/Cerebras function-calling format using explicit ES module imports.
// NOTE: Ensure manifest.json sets "background.service_worker" type to "module" so imports work.

import { MultiSourceSearchTool } from "./tools/search.js";

export const toolRegistry = [ MultiSourceSearchTool ].filter(Boolean);

export const openAITools = toolRegistry.map(t => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters, strict: true }
}));

export async function executeToolCall({ name, arguments: argsJson }) {
  console.log("[ToolRegistry] Executing tool:", name, argsJson);
  const tool = toolRegistry.find(t => t.name === name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  let args = {};
  try { args = argsJson ? JSON.parse(argsJson) : {}; } catch {}
  try {
    return await tool.execute(args);
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}
