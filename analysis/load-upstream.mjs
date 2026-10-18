// Loads upstream pi-intercom with a mock pi object and dumps every registered
// tool's metadata (description, promptSnippet, promptGuidelines, parameters)
// with character counts. Test/analysis helper only.
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const upstreamPath = require.resolve("pi-intercom/index.ts");

/** @param {string} env */
function setSubagentEnv(mode) {
  delete process.env.PI_SUBAGENT_ORCHESTRATOR_TARGET;
  delete process.env.PI_SUBAGENT_ORCHESTRATOR_SESSION_ID;
  delete process.env.PI_SUBAGENT_RUN_ID;
  delete process.env.PI_SUBAGENT_CHILD_AGENT;
  delete process.env.PI_SUBAGENT_CHILD_INDEX;
  delete process.env.PI_SUBAGENT_SUPERVISOR_CHANNEL_DIR;
  delete process.env.PI_INTERCOM_SESSION_ID;
  delete process.env.PI_INTERCOM_STABLE_ID;
  if (mode.startsWith("subagent")) {
    process.env.PI_SUBAGENT_ORCHESTRATOR_TARGET = "supervisor-sess";
    process.env.PI_SUBAGENT_ORCHESTRATOR_SESSION_ID = "11111111-2222-3333-4444-555555555555";
    process.env.PI_SUBAGENT_RUN_ID = "run-1";
    process.env.PI_SUBAGENT_CHILD_AGENT = "worker";
    process.env.PI_SUBAGENT_CHILD_INDEX = "0";
  }
}

function noop() {}
const handlers = { session_start: [], session_idle: [], message: [], tool_result: [], before_agent_start: [], agent_start: [], agent_end: [], session_end: [], before_compression: [], custom: [] };

function makeEventsSink() {
  const listeners = new Map();
  return {
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event)?.delete(fn);
    },
    once: (event, fn) => {
      const wrap = (payload) => { fn(payload); listeners.get(event)?.delete(wrap); };
      return makeEventsSink.prototype, wrap;
    },
    emit: noop,
    _listeners: listeners,
  };
}

export function makeMockPi() {
  const registered = { tools: [], commands: {}, shortcuts: {}, setActiveToolsCalled: false };
  const events = makeEventsSink();
  const pi = new Proxy({ events }, {
    get(target, prop) {
      if (prop === "events") return events;
      if (prop === "registerTool") {
        return (tool) => {
          // defineTool returns the definition; capture a deep clone.
          registered.tools.push(JSON.parse(JSON.stringify(tool)));
        };
      }
      if (prop === "registerCommand") return (name, opts) => { registered.commands[name] = opts; };
      if (prop === "registerShortcut") return (key, opts) => { registered.shortcuts[key] = opts; };
      if (prop === "on") return (event, fn) => events.on(event, fn);
      if (prop === "once") return (event, fn) => events.on(event, fn);
      if (prop === "emit") return noop;
      if (prop === "setActiveTools") { registered.setActiveToolsCalled = true; return noop; }
      if (prop === "appendEntry") return noop;
      if (prop === "getSessionName") return () => undefined;
      if (prop === "setSessionName") return noop;
      if (prop === "sendUserMessage" || prop === "sendMessage") return noop;
      if (prop === "registerMessageRenderer" || prop === "registerMarkdownTransformer" || prop === "registerEntryRenderer" || prop === "registerToolRenderer" || prop === "registerFlag" || prop === "getFlag") return noop;
      return noop;
    },
  });
  return { pi, registered, events };
}

export async function loadUpstream(mode = "plain") {
  // Cache-bust per mode so module-level state re-runs.
  const importPath = upstreamPath + `?mode=${mode}-${Date.now()}-${Math.random()}`;
  setSubagentEnv(mode);
  const mod = await import(importPath);
  const { pi, registered } = makeMockPi();
  mod.default(pi);
  return { mod, pi, registered };
}

// CLI: dump the tool inventory.
if (process.argv[1] && process.argv[1].endsWith("load-upstream.mjs")) {
  const out = {};
  for (const mode of ["plain", "subagent"]) {
    const { registered } = await loadUpstream(mode);
    out[mode] = registered.tools.map((t) => {
      const schemaJson = JSON.stringify(t.parameters);
      return {
        name: t.name,
        label: t.label,
        descriptionChars: t.description.length,
        promptSnippetChars: t.promptSnippet ? t.promptSnippet.length : 0,
        promptGuidelinesChars: t.promptGuidelines ? t.promptGuidelines.join("\n").length : 0,
        parametersChars: schemaJson.length,
        total: t.description.length + (t.promptSnippet?.length ?? 0) + (t.promptGuidelines?.join("\n").length ?? 0) + schemaJson.length,
      };
    });
  }
  console.log(JSON.stringify(out, null, 2));
  // Full dumps for inspection.
  for (const mode of ["plain", "subagent"]) {
    const { registered } = await loadUpstream(mode + "-dump");
    for (const t of registered.tools) {
      console.log(`\n===== ${mode} / ${t.name} =====`);
      console.log("--- description ---");
      console.log(t.description);
      console.log("--- promptSnippet ---");
      console.log(t.promptSnippet);
      console.log("--- promptGuidelines ---");
      console.log(JSON.stringify(t.promptGuidelines, null, 2));
      console.log("--- parameters ---");
      console.log(JSON.stringify(t.parameters, null, 2));
    }
  }
}
