import assert from "node:assert/strict";
import test from "node:test";
import { fillInArguments, INTERCOM_ACTIONS, leanOps } from "../lean/fill-ins.ts";

test("fills action → op for every intercom action", () => {
  for (const action of INTERCOM_ACTIONS) {
    assert.deepEqual(fillInArguments({ action, to: "x" }, false), { op: action, to: "x" });
    assert.deepEqual(fillInArguments({ action, to: "x" }, true), { op: action, to: "x" });
  }
  assert.deepEqual(fillInArguments({ action: "help" }, false), { op: "help" });
});

test("leaves a correct op-only call untouched (no misfire)", () => {
  assert.deepEqual(fillInArguments({ op: "send", to: "x", message: "m" }, false), {
    op: "send",
    to: "x",
    message: "m",
  });
  assert.deepEqual(fillInArguments({ op: "help", topic: "intercom" }, false), { op: "help", topic: "intercom" });
  assert.deepEqual(fillInArguments({}, false), {});
});

test("drops a redundant action that matches op", () => {
  assert.deepEqual(fillInArguments({ op: "send", action: "send", message: "m" }, false), {
    op: "send",
    message: "m",
  });
});

test("conflicting op and action is an error, not a guess", () => {
  assert.throws(() => fillInArguments({ op: "send", action: "ask", message: "m" }, false), /Both 'op' and 'action'/);
});

test("unknown action surfaces a clear error listing valid ops", () => {
  assert.throws(() => fillInArguments({ action: "list-all" }, false), /Unknown op 'list-all'/);
  try {
    fillInArguments({ action: "list-all" }, false);
    assert.fail("expected throw");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const op of leanOps(false)) assert.ok(message.includes(op), `error lists '${op}'`);
  }
});

test("supervisor aliases: tool name and reason values resolve to op supervisor", () => {
  assert.deepEqual(fillInArguments({ action: "contact_supervisor", message: "m" }, true), {
    op: "supervisor",
    message: "m",
  });
  assert.deepEqual(fillInArguments({ action: "supervisor", message: "m" }, true), {
    op: "supervisor",
    message: "m",
  });
  assert.deepEqual(fillInArguments({ action: "need_decision", message: "m" }, true), {
    op: "supervisor",
    reason: "need_decision",
    message: "m",
  });
  assert.deepEqual(fillInArguments({ op: "contact_supervisor", message: "m" }, true), {
    op: "supervisor",
    message: "m",
  });
  assert.deepEqual(fillInArguments({ op: "progress_update", message: "m" }, true), {
    op: "supervisor",
    reason: "progress_update",
    message: "m",
  });
});

test("an explicit reason is never overwritten by the op-as-reason fill-in", () => {
  assert.deepEqual(fillInArguments({ op: "need_decision", reason: "progress_update" }, true), {
    op: "need_decision",
    reason: "progress_update",
  });
});

test("in main mode supervisor-looking calls still surface as invalid op", () => {
  // The fill-in still resolves to "supervisor"; the schema enum (without it) is
  // what rejects it, and the error message lists the valid ops.
  assert.deepEqual(fillInArguments({ action: "need_decision", message: "m" }, false), {
    op: "supervisor",
    reason: "need_decision",
    message: "m",
  });
});

test("attachments and interviews passed as real structures become JSON strings", () => {
  const attachments = [{ type: "file", name: "a.ts", content: "x" }];
  assert.equal(
    fillInArguments({ op: "send", to: "x", message: "m", attachments }, false).attachments,
    JSON.stringify(attachments),
  );
  const interview = { questions: [{ id: "q1", type: "text", question: "why?" }] };
  assert.equal(fillInArguments({ op: "supervisor", reason: "interview_request", interview }, true).interview, JSON.stringify(interview));
});

test("already-string attachments and interviews pass through unchanged", () => {
  assert.equal(fillInArguments({ op: "send", attachments: "[]" }, false).attachments, "[]");
});

test("non-object input passes through unchanged", () => {
  assert.equal(fillInArguments(null, false), null);
  assert.equal(fillInArguments("send", false), "send");
});

test("null action or op does not trigger the fill-ins", () => {
  assert.deepEqual(fillInArguments({ action: null, message: "m" }, false), { message: "m" });
  assert.deepEqual(fillInArguments({ op: null, action: "send" }, false), { op: "send" });
});
