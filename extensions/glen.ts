// Frozen: no business logic here; the command lines are pinned by ingest.contract.test.ts.
import { spawn } from "node:child_process";

const GLEN_PI_HOOK_COMMANDS = {
  sessionStart: "glen session-start --agent pi",
  userPromptSubmit: "glen ingest --agent pi",
  stop: "glen ingest --agent pi",
  postToolUse: "glen pr-link --agent pi",
};

// Declared locally, not imported from pi, so this typechecks in the monorepo without a pi dependency.
type PiEvent = Record<string, unknown>;
type PiContext = {
  cwd: string;
  sessionManager?: {
    getSessionId?: () => string;
    getLeafId?: () => string;
  };
  ui?: { notify?: (text: string, level: string) => void };
};
type ExtensionAPI = {
  on: (
    event: string,
    handler: (event: PiEvent, ctx: PiContext) => Promise<unknown>,
  ) => void;
};

const HOOK_TIMEOUT_MS = 60_000;

// Fail open: a glen outage must never block or break a pi session.
const runGlenHook = (command: string, payload: object): Promise<string> =>
  new Promise((resolve) => {
    try {
      const [bin, ...args] = command.split(" ");
      const child = spawn(bin ?? "glen", args, {
        stdio: ["pipe", "pipe", "ignore"],
      });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => child.kill("SIGKILL"), HOOK_TIMEOUT_MS);
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stdin.on("error", () => {});
      child.on("error", () => {
        clearTimeout(timer);
        resolve("");
      });
      child.on("close", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    } catch {
      resolve("");
    }
  });

const parseHookOutput = (raw: string): { context: string; notice: string } => {
  const text = raw.trim();
  if (!text) return { context: "", notice: "" };
  try {
    const parsed = JSON.parse(text) as {
      hookSpecificOutput?: { additionalContext?: unknown };
      systemMessage?: unknown;
    };
    const context =
      typeof parsed.hookSpecificOutput?.additionalContext === "string"
        ? parsed.hookSpecificOutput.additionalContext
        : "";
    const notice =
      typeof parsed.systemMessage === "string" ? parsed.systemMessage : "";
    return { context, notice };
  } catch {
    return { context: text, notice: "" };
  }
};

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      typeof block === "string"
        ? block
        : block !== null &&
            typeof block === "object" &&
            typeof (block as { text?: unknown }).text === "string"
          ? (block as { text: string }).text
          : "",
    )
    .filter(Boolean)
    .join("\n");
};

export default function glenTeamMemory(pi: ExtensionAPI) {
  let pendingContext: string[] = [];
  let lastPrompt: string | null = null;
  let lastAssistant: string | null = null;
  let lastRunMessages: unknown[] = [];
  let fallbackSessionId: string | null = null;

  const sessionIdOf = (ctx: PiContext): string => {
    try {
      const id = ctx.sessionManager?.getSessionId?.();
      if (typeof id === "string" && id) return id;
    } catch {}
    fallbackSessionId ??= `pi-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    return fallbackSessionId;
  };

  const turnIdOf = (ctx: PiContext): string => {
    try {
      const leaf = ctx.sessionManager?.getLeafId?.();
      if (typeof leaf === "string" && leaf) return leaf;
    } catch {}
    return `t-${Date.now().toString(36)}`;
  };

  const notify = (ctx: PiContext, text: string): void => {
    try {
      ctx.ui?.notify?.(text, "info");
    } catch {}
  };

  // Delivered with the first prompt's injection: pi has no pre-prompt context channel.
  pi.on("session_start", async (event, ctx) => {
    try {
      pendingContext = [];
      lastPrompt = null;
      lastAssistant = null;
      lastRunMessages = [];
      const out = await runGlenHook(GLEN_PI_HOOK_COMMANDS.sessionStart, {
        hook_event_name: "SessionStart",
        session_id: sessionIdOf(ctx),
        cwd: ctx.cwd,
        source: typeof event.reason === "string" ? event.reason : undefined,
      });
      const { context, notice } = parseHookOutput(out);
      if (notice) notify(ctx, notice);
      if (context) pendingContext.push(context);
    } catch {}
    return undefined;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const prompt = event.prompt;
      if (typeof prompt !== "string" || !prompt) return undefined;
      lastPrompt = prompt;
      const out = await runGlenHook(GLEN_PI_HOOK_COMMANDS.userPromptSubmit, {
        hook_event_name: "UserPromptSubmit",
        session_id: sessionIdOf(ctx),
        cwd: ctx.cwd,
        prompt,
        turn_id: turnIdOf(ctx),
        ...(lastAssistant ? { last_assistant_message: lastAssistant } : {}),
      });
      const { context, notice } = parseHookOutput(out);
      if (notice) notify(ctx, notice);
      const combined = [...pendingContext, context]
        .filter(Boolean)
        .join("\n\n");
      pendingContext = [];
      if (!combined) return undefined;
      return {
        message: {
          customType: "glen-context",
          content: combined,
          display: false,
        },
      };
    } catch {}
    return undefined;
  });

  // agent_end fires per low-level run (retries included); agent_settled is the real end of a turn.
  pi.on("agent_end", async (event) => {
    try {
      if (Array.isArray(event.messages)) lastRunMessages = event.messages;
    } catch {}
    return undefined;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    try {
      const messages = lastRunMessages;
      lastRunMessages = [];
      const lastAssistantMessage = [...messages]
        .reverse()
        .find(
          (m) =>
            m !== null &&
            typeof m === "object" &&
            (m as { role?: unknown }).role === "assistant",
        );
      const answer = textOf(
        (lastAssistantMessage as { content?: unknown } | undefined)?.content,
      );
      if (answer) lastAssistant = answer;
      const prompt = lastPrompt;
      lastPrompt = null;
      if (!prompt || !answer) return undefined;
      const out = await runGlenHook(GLEN_PI_HOOK_COMMANDS.stop, {
        hook_event_name: "Stop",
        session_id: sessionIdOf(ctx),
        cwd: ctx.cwd,
        prompt,
        text: answer,
        turn_id: turnIdOf(ctx),
      });
      const { context, notice } = parseHookOutput(out);
      if (notice) notify(ctx, notice);
      if (context) pendingContext.push(context);
    } catch {}
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    try {
      if (event.toolName !== "bash" || event.isError === true) return undefined;
      const input = event.input as { command?: unknown } | undefined;
      const command = typeof input?.command === "string" ? input.command : "";
      const output = textOf(event.content);
      if (!command && !output) return undefined;
      const out = await runGlenHook(GLEN_PI_HOOK_COMMANDS.postToolUse, {
        hook_event_name: "PostToolUse",
        session_id: sessionIdOf(ctx),
        cwd: ctx.cwd,
        tool_name: "Bash",
        tool_input: { command },
        tool_response: output,
      });
      const { context } = parseHookOutput(out);
      if (!context) return undefined;
      return {
        content: [
          ...(Array.isArray(event.content) ? event.content : []),
          { type: "text", text: context },
        ],
      };
    } catch {}
    return undefined;
  });
}
