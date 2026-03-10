/**
 * memory-openmemory — OpenClaw memory plugin
 *
 * Integrates with an already-deployed OpenMemory backend over HTTP.
 * Provides auto-recall, auto-capture, and four manual tools.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginConfig {
  baseUrl: string;
  userId: string;
  apiKey?: string;
  autoRecall?: boolean;
  autoCapture?: boolean;
  recallLimit?: number;
  captureMaxChars?: number;
  timeoutMs?: number;
  searchPath?: string;
  storePath?: string;
  listPath?: string;
  deletePathTemplate?: string;
}

export interface MemoryItem {
  id?: string;
  text: string;
  score?: number;
}

interface StoreMetadata {
  source: string;
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

interface MessagePart {
  type?: string;
  text?: string;
  content?: string;
  [key: string]: unknown;
}

interface Message {
  role?: string;
  content?: string | MessagePart[] | unknown;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const CONFIG_DEFAULTS: Required<PluginConfig> = {
  baseUrl: "http://127.0.0.1:8765",
  userId: "default-user",
  apiKey: "",
  autoRecall: true,
  autoCapture: true,
  recallLimit: 5,
  captureMaxChars: 2000,
  timeoutMs: 8000,
  searchPath: "/memories/search",
  storePath: "/memories",
  listPath: "/memories",
  deletePathTemplate: "/memories/{id}",
};

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Search result normalisation
// ---------------------------------------------------------------------------

function normalizeSearchResults(payload: unknown): MemoryItem[] {
  if (!payload) return [];

  let items: unknown[] = [];

  if (Array.isArray(payload)) {
    items = payload;
  } else if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj["results"])) {
      items = obj["results"] as unknown[];
    } else if (Array.isArray(obj["items"])) {
      items = obj["items"] as unknown[];
    } else if (Array.isArray(obj["data"])) {
      items = obj["data"] as unknown[];
    }
  }

  return items
    .map((item): MemoryItem | null => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const text =
        (obj["memory"] as string | undefined) ??
        (obj["text"] as string | undefined) ??
        (obj["content"] as string | undefined) ??
        (obj["value"] as string | undefined) ??
        "";
      if (!text) return null;
      return {
        id: typeof obj["id"] === "string" ? obj["id"] : undefined,
        text,
        score: typeof obj["score"] === "number" ? obj["score"] : undefined,
      };
    })
    .filter((item): item is MemoryItem => item !== null);
}

// ---------------------------------------------------------------------------
// Message content helpers
// ---------------------------------------------------------------------------

export function stringifyMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") return String(part);
        const p = part as MessagePart;
        if (typeof p.text === "string") return p.text;
        if (p.type === "text") {
          if (typeof p.content === "string") return p.content;
        }
        if (typeof p.content === "string") return p.content;
        return JSON.stringify(part);
      })
      .join(" ");
  }
  if (content && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (typeof obj["text"] === "string") return obj["text"];
    if (typeof obj["content"] === "string") return obj["content"];
    return JSON.stringify(content);
  }
  return "";
}

export function extractLatestUserText(messages: Message[]): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === "user") {
      return stringifyMessageContent(msg.content).trim();
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Session summarisation (deterministic extraction, no LLM call)
// ---------------------------------------------------------------------------

export function summarizeConversation(
  messages: Message[],
  maxChars: number
): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";

  const lines: string[] = [];
  for (const msg of messages) {
    if (!msg || !msg.role) continue;
    const text = stringifyMessageContent(msg.content).trim();
    if (!text) continue;
    lines.push(`[${msg.role}] ${text}`);
  }

  if (lines.length === 0) return "";

  const joined = lines.join("\n");
  return joined.length > maxChars
    ? joined.slice(0, maxChars).trim()
    : joined.trim();
}

// ---------------------------------------------------------------------------
// Memory injection formatting
// ---------------------------------------------------------------------------

export function buildMemoryInjection(memories: MemoryItem[]): string {
  const lines = memories.map((m, i) => `Memory ${i + 1}: ${m.text}`);
  return `<relevant-memories>\n${lines.join("\n")}\n</relevant-memories>`;
}

// ---------------------------------------------------------------------------
// Tool output helper
// ---------------------------------------------------------------------------

function toToolText(text: string): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: "text", text }] };
}

// ---------------------------------------------------------------------------
// OpenMemory HTTP client
// ---------------------------------------------------------------------------

function createClient(config: Required<PluginConfig>, logger?: { warn?: (msg: string) => void; debug?: (msg: string) => void }) {
  function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }
    return headers;
  }

  async function search(query: string, limit: number): Promise<MemoryItem[]> {
    const url = joinUrl(config.baseUrl, config.searchPath);
    const body = JSON.stringify({ query, user_id: config.userId, limit });
    logger?.debug?.(`[memory-openmemory] search url=${url} query="${query}" limit=${limit}`);

    return withTimeout(async (signal) => {
      const response = await fetch(url, {
        method: "POST",
        headers: buildHeaders(),
        body,
        signal,
      });
      if (!response.ok) {
        logger?.warn?.(`[memory-openmemory] search returned HTTP ${response.status}`);
        return [];
      }
      const payload = await safeJson(response);
      return normalizeSearchResults(payload);
    }, config.timeoutMs).catch((err: unknown) => {
      logger?.warn?.(`[memory-openmemory] search failed: ${String(err)}`);
      return [];
    });
  }

  async function store(text: string, metadata: StoreMetadata): Promise<boolean> {
    const url = joinUrl(config.baseUrl, config.storePath);
    const body = JSON.stringify({ text, user_id: config.userId, metadata });
    logger?.debug?.(`[memory-openmemory] store url=${url}`);

    return withTimeout(async (signal) => {
      const response = await fetch(url, {
        method: "POST",
        headers: buildHeaders(),
        body,
        signal,
      });
      if (!response.ok) {
        logger?.warn?.(`[memory-openmemory] store returned HTTP ${response.status}`);
        return false;
      }
      return true;
    }, config.timeoutMs).catch((err: unknown) => {
      logger?.warn?.(`[memory-openmemory] store failed: ${String(err)}`);
      return false;
    });
  }

  async function list(): Promise<MemoryItem[]> {
    const baseListUrl = joinUrl(config.baseUrl, config.listPath);
    const url = `${baseListUrl}?user_id=${encodeURIComponent(config.userId)}`;
    logger?.debug?.(`[memory-openmemory] list url=${url}`);

    return withTimeout(async (signal) => {
      const response = await fetch(url, {
        method: "GET",
        headers: buildHeaders(),
        signal,
      });
      if (!response.ok) {
        logger?.warn?.(`[memory-openmemory] list returned HTTP ${response.status}`);
        return [];
      }
      const payload = await safeJson(response);
      return normalizeSearchResults(payload);
    }, config.timeoutMs).catch((err: unknown) => {
      logger?.warn?.(`[memory-openmemory] list failed: ${String(err)}`);
      return [];
    });
  }

  async function forget(id: string): Promise<boolean> {
    const path = config.deletePathTemplate.replace("{id}", encodeURIComponent(id));
    const url = joinUrl(config.baseUrl, path);
    logger?.debug?.(`[memory-openmemory] forget url=${url}`);

    return withTimeout(async (signal) => {
      const response = await fetch(url, {
        method: "DELETE",
        headers: buildHeaders(),
        signal,
      });
      if (!response.ok) {
        logger?.warn?.(`[memory-openmemory] forget returned HTTP ${response.status}`);
        return false;
      }
      return true;
    }, config.timeoutMs).catch((err: unknown) => {
      logger?.warn?.(`[memory-openmemory] forget failed: ${String(err)}`);
      return false;
    });
  }

  return { search, store, list, forget };
}

type OpenMemoryClient = ReturnType<typeof createClient>;

// ---------------------------------------------------------------------------
// Tool registrations
// ---------------------------------------------------------------------------

function registerTools(api: { registerTool?: (name: string, def: unknown, handler: (input: unknown) => Promise<unknown>) => void }, client: OpenMemoryClient, config: Required<PluginConfig>) {
  if (typeof api.registerTool !== "function") return;

  // memory_search
  api.registerTool(
    "memory_search",
    {
      description: "Search long-term memories stored in OpenMemory.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Maximum results to return.", default: 5 },
        },
        required: ["query"],
      },
    },
    async (input: unknown) => {
      const { query, limit = config.recallLimit } = (input ?? {}) as { query?: string; limit?: number };
      if (!query) return toToolText("Please provide a query.");
      const memories = await client.search(query, limit);
      if (memories.length === 0) return toToolText("No memories found.");
      const lines = memories.map((m, i) => `${i + 1}. ${m.text}`).join("\n");
      return toToolText(`Found ${memories.length} ${memories.length === 1 ? "memory" : "memories"}\n\n${lines}`);
    }
  );

  // memory_store
  api.registerTool(
    "memory_store",
    {
      description: "Store a piece of text as a long-term memory in OpenMemory.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to store as a memory." },
          metadata: { type: "object", description: "Optional additional metadata.", default: {} },
        },
        required: ["text"],
      },
    },
    async (input: unknown) => {
      const { text, metadata = {} } = (input ?? {}) as { text?: string; metadata?: Record<string, unknown> };
      if (!text) return toToolText("Please provide text to store.");
      const ok = await client.store(text, {
        source: "openclaw",
        type: "manual",
        timestamp: new Date().toISOString(),
        ...metadata,
      });
      return toToolText(ok ? "Stored memory successfully." : "Failed to store memory.");
    }
  );

  // memory_list
  api.registerTool(
    "memory_list",
    {
      description: "List all long-term memories stored in OpenMemory for the configured user.",
      inputSchema: { type: "object", properties: {} },
    },
    async () => {
      const memories = await client.list();
      if (memories.length === 0) return toToolText("No memories found.");
      const lines = memories.map((m) => `- [${m.id ?? "?"}] ${m.text}`).join("\n");
      return toToolText(`Memory count: ${memories.length}\n${lines}`);
    }
  );

  // memory_forget
  api.registerTool(
    "memory_forget",
    {
      description: "Delete a specific memory by its ID from OpenMemory.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID of the memory to delete." },
        },
        required: ["id"],
      },
    },
    async (input: unknown) => {
      const { id } = (input ?? {}) as { id?: string };
      if (!id) return toToolText("Please provide a memory ID.");
      const ok = await client.forget(id);
      return toToolText(ok ? `Deleted memory: ${id}` : `Failed to delete memory: ${id}`);
    }
  );
}

// ---------------------------------------------------------------------------
// Hook registrations
// ---------------------------------------------------------------------------

function registerHooks(
  api: { registerHook?: (event: string, handler: (ctx: unknown) => Promise<void>) => void; logger?: { warn?: (msg: string) => void; debug?: (msg: string) => void } },
  client: OpenMemoryClient,
  config: Required<PluginConfig>
) {
  if (typeof api.registerHook !== "function") return;

  // Auto-recall: inject relevant memories before each agent run
  if (config.autoRecall) {
    api.registerHook("agent:before-run", async (ctx: unknown) => {
      try {
        const context = ctx as { messages?: Message[] };
        const messages: Message[] = Array.isArray(context?.messages) ? context.messages : [];
        const query = extractLatestUserText(messages);
        if (!query) return;

        const memories = await client.search(query, config.recallLimit);
        if (memories.length === 0) return;

        const injection = buildMemoryInjection(memories);
        const systemMessage: Message = { role: "system", content: injection };
        context.messages = [systemMessage, ...messages];
      } catch (err: unknown) {
        api.logger?.warn?.(`[memory-openmemory] auto-recall error: ${String(err)}`);
      }
    });
  }

  // Auto-capture: save session summary when a new session is created
  if (config.autoCapture) {
    api.registerHook("command:new", async (ctx: unknown) => {
      try {
        const context = ctx as { messages?: Message[]; session?: { messages?: Message[] } };
        const messages: Message[] =
          Array.isArray(context?.messages)
            ? context.messages
            : Array.isArray(context?.session?.messages)
            ? context.session.messages
            : [];

        const summary = summarizeConversation(messages, config.captureMaxChars);
        if (!summary) return;

        await client.store(summary, {
          source: "openclaw",
          type: "session_summary",
          timestamp: new Date().toISOString(),
        });
        api.logger?.debug?.("[memory-openmemory] session summary captured.");
      } catch (err: unknown) {
        api.logger?.warn?.(`[memory-openmemory] auto-capture error: ${String(err)}`);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

export default function register(api: {
  config?: Partial<PluginConfig>;
  registerTool?: (...args: unknown[]) => void;
  registerHook?: (...args: unknown[]) => void;
  logger?: { warn?: (msg: string) => void; debug?: (msg: string) => void };
}): void {
  const raw: Partial<PluginConfig> =
    api.config && typeof api.config === "object" ? api.config : {};

  const config: Required<PluginConfig> = {
    ...CONFIG_DEFAULTS,
    ...raw,
  };

  const logger = api.logger;
  const client = createClient(config, logger);

  registerTools(api as Parameters<typeof registerTools>[0], client, config);
  registerHooks(api as Parameters<typeof registerHooks>[0], client, config);

  logger?.debug?.("[memory-openmemory] plugin registered successfully.");
}
