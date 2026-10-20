/**
 * The lean tool: one merged `intercom` tool that forwards to the upstream
 * pi-intercom tools collected by the proxy in index.ts.
 *
 * - ops list / list-cwd / send / ask / handover / reply / pending / status /
 *   cancel forward to upstream's `intercom` execute with `op` mapped back to
 *   its `action` parameter;
 * - op supervisor (only when upstream registered `contact_supervisor`, i.e. in
 *   subagent sessions) forwards to that tool;
 * - op help returns the full upstream description, snippet, guidelines, and
 *   parameter schema for a tool.
 *
 * The lean descriptions and schemas below replace the upstream ones the model
 * reads on every request; every behavioral rule about how to call the tool is
 * kept. The upstream renderers are reused so the UI stays identical.
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { createRequire } from "node:module";
import { Type } from "typebox";
import { fillInArguments, INTERCOM_ACTIONS, leanOps, SUPERVISOR_REASONS } from "./fill-ins.ts";

export const INTERCOM_TOOL_NAME = "intercom";
export const SUPERVISOR_TOOL_NAME = "contact_supervisor";

/**
 * Minimal structural type for what we collect from upstream via the proxy.
 * `any` in the callback positions matches upstream's ToolDefinition shapes.
 */
export type UpstreamTool = {
  name: string;
  label?: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  // biome-ignore lint/suspicious/noExplicitAny: forwarded verbatim to upstream
  execute: (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) => Promise<any>;
  // biome-ignore lint/suspicious/noExplicitAny: forwarded verbatim to upstream
  renderCall?: (args: any, theme: any, context: any) => any;
  // biome-ignore lint/suspicious/noExplicitAny: forwarded verbatim to upstream
  renderResult?: (result: any, options: any, theme: any, context: any) => any;
};

const INTERCOM_FIELDS = [
  "to",
  "message",
  "attachments",
  "replyTo",
  "messageId",
  "supersedes",
  "retryOf",
  "cwd",
  "openProjectPaneIfMissing",
  "focus",
] as const;

const SUPERVISOR_FIELDS = ["reason", "message", "interview"] as const;

let upstreamVersionCache: string | null = null;
export function upstreamVersion(): string {
  if (upstreamVersionCache === null) {
    try {
      upstreamVersionCache = createRequire(import.meta.url)("pi-intercom/package.json").version;
    } catch {
      upstreamVersionCache = "unknown";
    }
  }
  return upstreamVersionCache;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Lean texts and schema
// ---------------------------------------------------------------------------

function leanDescription(hasSupervisor: boolean): string {
  const paragraphs = [
    "Communicate with other pi sessions running on this machine.",
    'Address a session by name, full session ID, or the short id shown in parentheses by list (a leading ID prefix is enough; with no exact name or ID match, a leading name prefix shared by exactly one connected session also resolves, otherwise use the full name); prefer the short id when two sessions share a name, re-list before reusing an ID, and skip a target that resolves to self.',
    'list and list-cwd show sessions; cwd filters by directory ("." is the current cwd). send delivers without waiting; ask waits for the reply. handover summarizes this session with the current model and sends it to the target, which acts on it; message is the optional next task. reply answers the active or single pending ask (to disambiguates). cancel requests cancellation of a sent message (messageId). pending lists unresolved inbound asks; status shows connection state.',
    "For send, ask, and handover, cwd scopes target lookup to that directory; omit to to target the sole live session there, and openProjectPaneIfMissing opens a visible Herdr project pane with a new Pi session when none is live there (focus focuses the pane).",
  ];
  if (hasSupervisor) {
    paragraphs.push(
      "supervisor contacts the supervisor that delegated this task: reason need_decision or interview_request wait for the reply, progress_update does not. Use it for decisions, structured questions, and plan-changing discoveries, not routine completion.",
    );
  }
  paragraphs.push("help returns the full upstream documentation and parameters for a tool (topic picks one).");
  return paragraphs.join("\n\n");
}

function leanSnippet(hasSupervisor: boolean): string {
  return hasSupervisor
    ? "Coordinate with other local pi sessions: list peers, send, ask, or hand over; subagents contact their supervisor via op supervisor."
    : "Coordinate with other local pi sessions: list peers, send, ask, or hand over.";
}

// biome-ignore lint/suspicious/noExplicitAny: TypeBox StringEnum input
function leanParameters(hasSupervisor: boolean): any {
  return Type.Object({
    op: StringEnum(leanOps(hasSupervisor)),
    to: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    cwd: Type.Optional(Type.String()),
    openProjectPaneIfMissing: Type.Optional(Type.Boolean()),
    focus: Type.Optional(Type.Boolean()),
    replyTo: Type.Optional(Type.String()),
    messageId: Type.Optional(Type.String()),
    supersedes: Type.Optional(
      Type.String({ description: "message ID this send/ask replaces; same sender and receiver only" }),
    ),
    retryOf: Type.Optional(
      Type.String({ description: "message ID this user-authored retry repeats; always sends a new message ID" }),
    ),
    attachments: Type.Optional(
      Type.String({ description: "JSON array of {type: file|snippet|context, name, content, language?}" }),
    ),
    ...(hasSupervisor
      ? {
          reason: Type.Optional(StringEnum([...SUPERVISOR_REASONS])),
          interview: Type.Optional(
            Type.String({
              description:
                "JSON: {title?, description?, questions: [{id, type: single|multi|text|image|info, question, options?, context?}]}",
            }),
          ),
        }
      : {}),
    topic: Type.Optional(StringEnum([INTERCOM_TOOL_NAME, SUPERVISOR_TOOL_NAME])),
  });
}

// ---------------------------------------------------------------------------
// Help op
// ---------------------------------------------------------------------------

function helpSection(tool: UpstreamTool): string {
  const lines: string[] = [
    `Full documentation for upstream pi-intercom@${upstreamVersion()} tool "${tool.name}"${
      tool.name === SUPERVISOR_TOOL_NAME ? " (lean op: supervisor)" : ""
    }.`,
    "",
    `label: ${tool.label ?? "(none)"}`,
    "",
    "description:",
    String(tool.description),
  ];
  if (tool.promptSnippet) {
    lines.push("", "promptSnippet:", tool.promptSnippet);
  }
  if (tool.promptGuidelines?.length) {
    lines.push("", "promptGuidelines:", ...tool.promptGuidelines.map((g) => `- ${g}`));
  }
  lines.push("", "parameters:", JSON.stringify(tool.parameters, null, 2));
  return lines.join("\n");
}

function helpResult(tools: Map<string, UpstreamTool>, topic: unknown): toolResult {
  const names =
    topic === SUPERVISOR_TOOL_NAME
      ? [SUPERVISOR_TOOL_NAME]
      : topic === INTERCOM_TOOL_NAME
        ? [INTERCOM_TOOL_NAME]
        : [...tools.keys()];
  const sections: string[] = [];
  for (const name of names) {
    const tool = tools.get(name);
    if (!tool) {
      if (topic === name) {
        return errorResult(`Unknown help topic '${String(topic)}'.`);
      }
      continue;
    }
    sections.push(helpSection(tool));
  }
  if (sections.length === 0) {
    return errorResult("No upstream pi-intercom tools are registered in this session.");
  }
  return { content: [{ type: "text", text: sections.join("\n\n---\n\n") }], details: {} };
}

// ---------------------------------------------------------------------------
// Lean tool
// ---------------------------------------------------------------------------

type toolResult = {
  // biome-ignore lint/suspicious/noExplicitAny: matches pi's AgentToolResult
  content: Array<{ type: "text"; text: string } | any>;
  // biome-ignore lint/suspicious/noExplicitAny: matches pi's AgentToolResult details
  details: any;
};

function errorResult(text: string): toolResult {
  return { content: [{ type: "text", text }], details: { error: true } };
}

function parseJsonField(field: string, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") {
    if (typeof value === "object") return { ok: true, value }; // already a structure; prepareArguments was bypassed
    return { ok: false, error: `'${field}' must be a JSON string or array/object` };
  }
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error: `'${field}' must be a JSON string: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function buildLeanTool(tools: Map<string, UpstreamTool>) {
  // Frozen at build time: the tool list cannot change mid-session.
  const hasSupervisor = tools.has(SUPERVISOR_TOOL_NAME);

  return defineTool({
    name: INTERCOM_TOOL_NAME,
    label: "Intercom",
    description: leanDescription(hasSupervisor),
    promptSnippet: leanSnippet(hasSupervisor),
    parameters: leanParameters(hasSupervisor),

    prepareArguments(args: unknown) {
      return fillInArguments(args, hasSupervisor);
    },

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { op, topic, ...rest } = params as Record<string, unknown>;

      if (op === "help") {
        return helpResult(tools, topic);
      }

      if (op === "supervisor") {
        const tool = tools.get(SUPERVISOR_TOOL_NAME);
        if (!tool) {
          return errorResult(
            `op 'supervisor' is not available in this session (contact_supervisor is registered only in subagent sessions); valid ops: ${leanOps(false).join(", ")}.`,
          );
        }
        const interview = parseJsonField("interview", rest.interview);
        if (!interview.ok) return errorResult(interview.error);
        if (interview.value !== undefined && !isPlainObject(interview.value)) {
          return errorResult("'interview' must be a JSON object.");
        }
        const args: Record<string, unknown> = {};
        for (const field of SUPERVISOR_FIELDS) {
          const value = field === "interview" ? interview.value : rest[field];
          if (value !== undefined) args[field] = value;
        }
        return tool.execute(toolCallId, args, signal, onUpdate, ctx);
      }

      const tool = tools.get(INTERCOM_TOOL_NAME);
      if (!tool) {
        return errorResult("The upstream intercom tool is missing; no op can be executed.");
      }
      const attachments = parseJsonField("attachments", rest.attachments);
      if (!attachments.ok) return errorResult(attachments.error);
      if (attachments.value !== undefined && !Array.isArray(attachments.value)) {
        return errorResult("'attachments' must be a JSON array.");
      }
      const args: Record<string, unknown> = { action: op };
      for (const field of INTERCOM_FIELDS) {
        const value = field === "attachments" ? attachments.value : rest[field];
        if (value !== undefined) args[field] = value;
      }
      return tool.execute(toolCallId, args, signal, onUpdate, ctx);
    },

    renderCall(args, theme, context) {
      const params = args as Record<string, unknown>;
      const { op, ...rest } = params;
      const isSupervisor = params.op === "supervisor";
      const tool = isSupervisor ? tools.get(SUPERVISOR_TOOL_NAME) : tools.get(INTERCOM_TOOL_NAME);
      if (!tool?.renderCall) return new Text("intercom", 0, 0);
      const shim = isSupervisor
        ? { reason: params.reason, message: params.message, interview: tryParseJson(params.interview) }
        : { ...rest, action: params.op };
      return tool.renderCall(shim, theme, context);
    },

    renderResult(result, options, theme, context) {
      const details = (result as { details?: Record<string, unknown> })?.details;
      const isSupervisor = details !== undefined && ("structuredReplyParseError" in details || "reason" in details);
      const tool = isSupervisor ? tools.get(SUPERVISOR_TOOL_NAME) : tools.get(INTERCOM_TOOL_NAME);
      if (!tool?.renderResult) return new Text("", 0, 0);
      return tool.renderResult(result, options, theme, context);
    },
  });
}

export { INTERCOM_ACTIONS };
