import { Query } from './query';
import { rank, type PickStats } from './ranking';
import type { MatchReturn, Result, Tool, ToolContext } from './types';

/** Identity helper so tool files get full type checking. */
export function defineTool<T extends Tool>(tool: T): T {
  return tool;
}

function toArray(value: MatchReturn): Result[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function isPromise<T>(value: unknown): value is Promise<T> {
  return !!value && typeof (value as Promise<T>).then === 'function';
}

export interface RunOptions {
  stats?: PickStats;
  limit?: number;
  /** Called with the full ranked list each time more results arrive. */
  onUpdate?: (results: Result[]) => void;
}

export class ToolRegistry {
  private readonly tools: Tool[] = [];

  register(...tools: Tool[]): this {
    for (const tool of tools) {
      if (!/^[a-z0-9-]+$/.test(tool.id)) throw new Error(`Tool id "${tool.id}" must be kebab-case`);
      if (this.tools.some((t) => t.id === tool.id)) throw new Error(`Tool "${tool.id}" is already registered`);
      this.tools.push(tool);
    }
    return this;
  }

  list(): readonly Tool[] {
    return this.tools;
  }

  get(id: string): Tool | undefined {
    return this.tools.find((t) => t.id === id);
  }

  private stamp(tool: Tool, results: Result[]): Result[] {
    return results.map((r) => ({ ...r, id: `${tool.id}:${r.id}`, toolId: tool.id }));
  }

  /**
   * Ask every tool about the query. Synchronous results are ranked and
   * returned right away (and passed to onUpdate); asynchronous ones are merged
   * in as they resolve. Once ctx.signal aborts, no further updates fire, so a
   * slow answer for an old query can never overwrite a newer one.
   * The returned promise resolves with the final ranked list.
   */
  async run(input: string | Query, ctx: ToolContext, options: RunOptions = {}): Promise<Result[]> {
    const query = typeof input === 'string' ? new Query(input) : input;
    const { stats = {}, limit, onUpdate } = options;
    const collected: Result[] = [];
    const pending: Promise<void>[] = [];
    const publish = () => {
      const ranked = rank(collected, query.text, stats, limit);
      if (!ctx.signal.aborted) onUpdate?.(ranked);
      return ranked;
    };

    for (const tool of this.tools) {
      let out: MatchReturn | Promise<MatchReturn>;
      try {
        out = tool.match(query, ctx);
      } catch (err) {
        console.warn(`[mooncow] tool ${tool.id} threw while matching`, err);
        continue;
      }
      if (isPromise<MatchReturn>(out)) {
        pending.push(
          out.then(
            (value) => {
              if (ctx.signal.aborted) return;
              collected.push(...this.stamp(tool, toArray(value)));
              publish();
            },
            (err) => {
              if (!ctx.signal.aborted && (err as Error)?.name !== 'AbortError') {
                console.warn(`[mooncow] tool ${tool.id} failed`, err);
              }
            },
          ),
        );
      } else {
        collected.push(...this.stamp(tool, toArray(out)));
      }
    }

    publish();
    await Promise.all(pending);
    return rank(collected, query.text, stats, limit);
  }
}
