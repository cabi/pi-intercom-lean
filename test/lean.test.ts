import assert from "node:assert/strict";
import test from "node:test";
import { makeCollectingProxy } from "../index.ts";
import { INTERCOM_ACTIONS, leanOps } from "../lean/fill-ins.ts";
import { buildLeanTool, INTERCOM_TOOL_NAME, SUPERVISOR_TOOL_NAME, type UpstreamTool } from "../lean/tool.ts";
import { CTX_STUB, loadUpstreamTools, makeMockPi, spyTools } from "./helpers.ts";

// biome-ignore lint/suspicious/noExplicitAny: pi's AgentToolResult
type AnyResult = any;

function opEnum(tool: ReturnType<typeof buildLeanTool>): string[] {
  return (tool.parameters as { properties: { op: { enum: string[] } } }).properties.op.enum;
}

test("upstream registers only intercom in main mode; lean tool hides supervisor", async () => {
  const upstream = await loadUpstreamTools("main");
  assert.deepEqual([...upstream.keys()].sort(), [INTERCOM_TOOL_NAME]);

  const lean = buildLeanTool(upstream);
  assert.equal(lean.name, INTERCOM_TOOL_NAME);
  assert.deepEqual(opEnum(lean), leanOps(false));
  assert.ok(!lean.description.includes("supervisor"), "main-mode description has no supervisor paragraph");
});

test("upstream registers both tools in subagent mode; lean op enum includes supervisor", async () => {
  const upstream = await loadUpstreamTools("subagent");
  assert.deepEqual([...upstream.keys()].sort(), [INTERCOM_TOOL_NAME, SUPERVISOR_TOOL_NAME].sort());

  const lean = buildLeanTool(upstream);
  assert.deepEqual(opEnum(lean), leanOps(true));
  assert.ok(lean.description.includes("supervisor"), "subagent description documents op supervisor");
});

test("lean texts obey the trimming rules", async () => {
  const lean = buildLeanTool(await loadUpstreamTools("subagent"));
  for (const text of [lean.description, lean.promptSnippet, JSON.stringify(lean.parameters)]) {
    assert.match(text, /\S/);
    assert.doesNotMatch(text, /\b(MUST|NEVER|ALWAYS|IMPORTANT)\b/);
    // No all-caps shouting; acronyms up to 4 letters (ID, JSON, cwd-style) are fine.
    assert.doesNotMatch(text, /[A-Z]{5,}/);
  }
  // Parameter descriptions kept only where names are unclear or shapes are inline.
  const props = (lean.parameters as { properties: Record<string, { description?: string }> }).properties;
  for (const field of ["to", "message", "cwd", "replyTo", "messageId", "focus", "openProjectPaneIfMissing", "reason", "topic", "op"]) {
    assert.equal(props[field]?.description, undefined, `${field} has no description`);
  }
  assert.ok(props.attachments?.description?.startsWith("JSON"));
  assert.ok(props.interview?.description?.startsWith("JSON"));
});

test("every intercom op reaches upstream intercom.execute with op mapped to action", async () => {
  const upstream = await loadUpstreamTools("subagent");
  const calls = spyTools(upstream);
  const lean = buildLeanTool(upstream);

  const samples: Record<string, Record<string, unknown>> = {
    list: {},
    "list-cwd": { cwd: "/tmp" },
    send: { to: "peer", message: "hi" },
    ask: { to: "peer", message: "q?" },
    handover: { to: "peer", message: "next task" },
    reply: { message: "answer" },
    pending: {},
    status: {},
    cancel: { messageId: "m-1" },
  };

  for (const op of INTERCOM_ACTIONS) {
    const result: AnyResult = await lean.execute("call-1", { op, ...samples[op] }, undefined, undefined, CTX_STUB);
    const call = calls.find((c) => c.params.action === op);
    assert.ok(call, `op ${op} reached upstream execute`);
    assert.equal(call.tool, INTERCOM_TOOL_NAME);
    for (const [key, value] of Object.entries(samples[op])) {
      assert.deepEqual(call.params[key], value, `op ${op} forwards ${key}`);
    }
    assert.equal(result.content[0].text, `sentinel:${INTERCOM_TOOL_NAME}`);
  }
});

test("send forwards parsed attachments, threading, and retry fields", async () => {
  const upstream = await loadUpstreamTools("main");
  const calls = spyTools(upstream);
  const lean = buildLeanTool(upstream);

  await lean.execute(
    "call-1",
    {
      op: "send",
      to: "peer",
      message: "hi",
      attachments: JSON.stringify([{ type: "snippet", name: "a.ts", content: "x" }]),
      replyTo: "m-0",
      supersedes: "m-1",
      retryOf: "m-2",
    },
    undefined,
    undefined,
    CTX_STUB,
  );

  const call = calls.find((c) => c.params.action === "send");
  assert.ok(call);
  assert.deepEqual(call.params.attachments, [{ type: "snippet", name: "a.ts", content: "x" }]);
  assert.equal(call.params.replyTo, "m-0");
  assert.equal(call.params.supersedes, "m-1");
  assert.equal(call.params.retryOf, "m-2");
  assert.equal("op" in call.params, false, "lean-only fields are not forwarded");
});

test("malformed attachments JSON returns a clear error without calling upstream", async () => {
  const upstream = await loadUpstreamTools("main");
  const calls = spyTools(upstream);
  const lean = buildLeanTool(upstream);

  const result: AnyResult = await lean.execute("call-1", { op: "send", to: "p", message: "m", attachments: "[nope" }, undefined, undefined, CTX_STUB);
  assert.equal(result.details.error, true);
  assert.match(result.content[0].text, /'attachments' must be a JSON string/);
  assert.equal(calls.length, 0);
});

test("supervisor op reaches upstream contact_supervisor with parsed interview", async () => {
  const upstream = await loadUpstreamTools("subagent");
  const calls = spyTools(upstream);
  const lean = buildLeanTool(upstream);

  const interview = { title: "t", questions: [{ id: "q1", type: "text", question: "why?" }] };
  const result: AnyResult = await lean.execute(
    "call-1",
    { op: "supervisor", reason: "interview_request", interview: JSON.stringify(interview) },
    undefined,
    undefined,
    CTX_STUB,
  );

  const call = calls.find((c) => c.tool === SUPERVISOR_TOOL_NAME);
  assert.ok(call, "supervisor op reached contact_supervisor");
  assert.equal(call.params.reason, "interview_request");
  assert.deepEqual(call.params.interview, interview);
  assert.equal("op" in call.params, false);
  assert.equal(result.content[0].text, `sentinel:${SUPERVISOR_TOOL_NAME}`);
});

test("supervisor op in main mode returns a clear error", async () => {
  const upstream = await loadUpstreamTools("main");
  const calls = spyTools(upstream);
  const lean = buildLeanTool(upstream);

  // Called directly with an op the schema would already reject in main mode.
  const result: AnyResult = await lean.execute("call-1", { op: "supervisor", reason: "need_decision" }, undefined, undefined, CTX_STUB);
  assert.equal(result.details.error, true);
  assert.match(result.content[0].text, /not available in this session/);
  assert.equal(calls.length, 0);
});

test("help returns the full upstream description and parameters", async () => {
  const upstream = await loadUpstreamTools("subagent");
  const lean = buildLeanTool(upstream);

  const result: AnyResult = await lean.execute("call-1", { op: "help", topic: INTERCOM_TOOL_NAME }, undefined, undefined, CTX_STUB);
  const text: string = result.content.map((c: { text?: string }) => c.text ?? "").join("");
  const upstreamIntercom = upstream.get(INTERCOM_TOOL_NAME)!;
  assert.ok(text.includes(upstreamIntercom.description), "full upstream description is included");
  assert.ok(text.includes(upstreamIntercom.promptSnippet!));
  assert.ok(text.includes("parameters:"));
  for (const field of ["action", "supersedes", "retryOf", "openProjectPaneIfMissing"]) {
    assert.ok(text.includes(`"${field}"`), `parameters JSON includes ${field}`);
  }

  const supervisorHelp: AnyResult = await lean.execute("call-1", { op: "help", topic: SUPERVISOR_TOOL_NAME }, undefined, undefined, CTX_STUB);
  const supervisorText: string = supervisorHelp.content.map((c: { text?: string }) => c.text ?? "").join("");
  assert.ok(supervisorText.includes(upstream.get(SUPERVISOR_TOOL_NAME)!.description));
  for (const field of ["reason", "interview", "interview_request"]) {
    assert.ok(supervisorText.includes(field), `supervisor help includes ${field}`);
  }

  const both: AnyResult = await lean.execute("call-1", { op: "help" }, undefined, undefined, CTX_STUB);
  const bothText: string = both.content.map((c: { text?: string }) => c.text ?? "").join("");
  assert.ok(bothText.includes(`"${INTERCOM_TOOL_NAME}"`));
  assert.ok(bothText.includes(`"${SUPERVISOR_TOOL_NAME}"`));
});

test("prepareArguments is wired with the frozen mode", async () => {
  const lean = buildLeanTool(await loadUpstreamTools("main"));
  // biome-ignore lint/suspicious/noExplicitAny: prepareArguments is typed for the schema
  const prepared = (lean.prepareArguments as any)({ action: "send", to: "x", message: "m" });
  assert.deepEqual(prepared, { op: "send", to: "x", message: "m" });
});

test("renderCall shims map op back to upstream argument shapes", async () => {
  const upstream = await loadUpstreamTools("subagent");
  const calls = spyTools(upstream);
  const lean = buildLeanTool(upstream);
  const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s };

  lean.renderCall({ op: "send", to: "peer", message: "hi" } as never, theme as never, { expanded: false } as never);
  const intercomCall = calls.renderCalls.find((c) => c.tool === INTERCOM_TOOL_NAME);
  assert.ok(intercomCall);
  assert.equal(intercomCall.params.action, "send");
  assert.equal(intercomCall.params.to, "peer");
  assert.equal("op" in intercomCall.params, false);

  const interview = { title: "T", questions: [] };
  lean.renderCall({ op: "supervisor", reason: "need_decision", interview: JSON.stringify(interview) } as never, theme as never, { expanded: false } as never);
  const supervisorCall = calls.renderCalls.find((c) => c.tool === SUPERVISOR_TOOL_NAME);
  assert.ok(supervisorCall);
  assert.equal(supervisorCall.params.reason, "need_decision");
  assert.deepEqual(supervisorCall.params.interview, interview);
});

test("proxy blocks tool-list changes: registerTool collected, setActiveTools dropped", () => {
  const mock = makeMockPi();
  const { pi: proxy, tools } = makeCollectingProxy(mock.pi);

  const fakeTool = { name: "loader", description: "d", parameters: {}, execute: async () => ({ content: [] }) } as unknown as UpstreamTool;
  proxy.registerTool(fakeTool);
  proxy.setActiveTools(["loader", "other"]);
  proxy.on("session_start", () => {});

  assert.deepEqual([...tools.keys()], ["loader"], "registerTool is collected, not registered");
  assert.equal(mock.tools.size, 0, "nothing was registered on the real pi");
  assert.ok(!mock.forwarded.some((c) => c.method === "setActiveTools" || c.method === "registerTool"), "no tool-list call reached the real pi");
  assert.ok(mock.forwarded.some((c) => c.method === "on"), "non-tool calls pass through");
});

test("late registerTool from a captured proxy reference is still swallowed", () => {
  const mock = makeMockPi();
  const { pi: proxy, tools } = makeCollectingProxy(mock.pi);
  // Simulates upstream registering another tool later, e.g. from an event handler.
  const captured = { registerLate: () => proxy.registerTool({ name: "late", description: "", parameters: {}, execute: async () => ({ content: [] }) } as unknown as UpstreamTool) };
  captured.registerLate();
  assert.deepEqual([...tools.keys()], ["late"]);
  assert.equal(mock.tools.size, 0, "the lean tool list cannot grow mid-session");
});

test("extension entry registers exactly one lean tool on the real pi", async () => {
  const mock = makeMockPi();
  (await import("../index.ts")).default(mock.pi as never);
  assert.deepEqual([...mock.tools.keys()], [INTERCOM_TOOL_NAME], "exactly one lean tool registered");
  assert.equal(mock.tools.get(INTERCOM_TOOL_NAME)!.label, "Intercom", "the registered tool is the lean one");
});

test("execute survives prepareArguments being bypassed: raw structures forward as-is", async () => {
  const tools = await loadUpstreamTools("subagent");
  const calls = spyTools(tools);
  const lean = buildLeanTool(tools);
  const attachments = [{ type: "snippet", name: "a.ts", content: "x" }];
  await lean.execute("call-1", { op: "send", to: "p", message: "m", attachments }, undefined, undefined, CTX_STUB);
  assert.deepEqual(calls[0].params.attachments, attachments, "raw array forwards without stringify round-trip");

  const interview = { title: "T", questions: [{ id: "q1", type: "single", question: "Q?", options: [{ label: "a", description: "" }, { label: "b", description: "" }] }] };
  await lean.execute("call-2", { op: "supervisor", reason: "need_decision", message: "m", interview }, undefined, undefined, CTX_STUB);
  const supervisor = calls.find((c) => c.tool === "contact_supervisor")!;
  assert.ok(supervisor, "supervisor call reached upstream");
  assert.deepEqual(supervisor.params.interview, interview, "raw interview object forwards as-is");

  const bad = await lean.execute("call-3", { op: "send", to: "p", message: "m", attachments: 42 }, undefined, undefined, CTX_STUB);
  assert.match((bad as AnyResult).content[0].text, /'attachments' must be a JSON string or array\/object/);
});
