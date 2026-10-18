/**
 * Test helpers: a recording mock `pi` object and a loader that runs the real
 * upstream pi-intercom extension in main or subagent mode.
 */

import { makeCollectingProxy } from "../index.ts";
import type { UpstreamTool } from "../lean/tool.ts";

export type PiCall = { method: string; args: unknown[] };

/**
 * Mock ExtensionAPI: registerTool records into `tools`, every other method
 * access returns a recording no-op function. The mock is also the target used
 * to test makeCollectingProxy's blocking behavior.
 */
export function makeMockPi() {
  const tools = new Map<string, UpstreamTool>();
  const forwarded: PiCall[] = [];
  // A no-op that is both callable and infinitely nestable (pi.events.on(...)).
  // biome-ignore lint/suspicious/noExplicitAny: mock of a rich interface
  const noOp = (path: string): any =>
    new Proxy(() => undefined, {
      get(_target, prop) {
        if (typeof prop === "symbol") return undefined;
        return noOp(`${path}.${String(prop)}`);
      },
      apply(_target, _thisArg, args) {
        forwarded.push({ method: path, args });
        return undefined;
      },
    });
  // biome-ignore lint/suspicious/noExplicitAny: mock of a rich interface
  const pi = new Proxy({} as any, {
    // biome-ignore lint/suspicious/noExplicitAny: mock of a rich interface
    get(_target: any, prop: string | symbol) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "registerTool") {
        return (tool: UpstreamTool) => {
          tools.set(tool.name, tool);
        };
      }
      return noOp(String(prop));
    },
  });
  return { pi, tools, forwarded };
}

let importCounter = 0;

const SUBAGENT_ENV_KEYS = [
  "PI_SUBAGENT_ORCHESTRATOR_TARGET",
  "PI_SUBAGENT_ORCHESTRATOR_SESSION_ID",
  "PI_SUBAGENT_RUN_ID",
  "PI_SUBAGENT_CHILD_AGENT",
  "PI_SUBAGENT_CHILD_INDEX",
  "PI_SUBAGENT_SUPERVISOR_CHANNEL_DIR",
] as const;

/**
 * Loads the real upstream extension in the requested mode and returns the
 * tools it registers against a mock pi. Subagent mode sets the env vars
 * upstream's readChildOrchestratorMetadata requires (and clears
 * PI_SUBAGENT_SUPERVISOR_CHANNEL_DIR which would suppress contact_supervisor).
 */
export async function loadUpstreamTools(mode: "main" | "subagent"): Promise<Map<string, UpstreamTool>> {
  const saved = Object.fromEntries(SUBAGENT_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of SUBAGENT_ENV_KEYS) delete process.env[key];
  if (mode === "subagent") {
    process.env.PI_SUBAGENT_ORCHESTRATOR_TARGET = "supervisor-session";
    process.env.PI_SUBAGENT_RUN_ID = "run-1";
    process.env.PI_SUBAGENT_CHILD_AGENT = "worker";
    process.env.PI_SUBAGENT_CHILD_INDEX = "0";
  }
  try {
    const mod = await import(`../node_modules/pi-intercom/index.ts?lean-test=${mode}-${importCounter++}`);
    const mock = makeMockPi();
    mod.default(mock.pi);
    return mock.tools;
  } finally {
    for (const key of SUBAGENT_ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export type SpiedCall = { tool: string; params: Record<string, unknown> };

/**
 * Replaces each collected upstream tool's execute/renderCall with recorders so
 * tests can assert the lean tool's forwarding without touching the broker.
 */
export function spyTools(tools: Map<string, UpstreamTool>): SpiedCall[] {
  const executeCalls: SpiedCall[] = [];
  const renderCalls: SpiedCall[] = [];
  for (const [name, tool] of [...tools.entries()]) {
    tools.set(name, {
      ...tool,
      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
        executeCalls.push({ tool: name, params });
        return { content: [{ type: "text", text: `sentinel:${name}` }], details: {} };
      },
      renderCall: (args: Record<string, unknown>) => {
        renderCalls.push({ tool: name, params: args });
        return { rendered: true, tool: name };
      },
      renderResult: (result: unknown) => {
        return { rendered: true, tool: name, result };
      },
    });
  }
  return Object.assign(executeCalls, { renderCalls });
}

export const CTX_STUB = { sessionManager: { getSessionId: () => "test-session" } };
