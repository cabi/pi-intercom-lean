/**
 * Deterministic pre-validation fixes for common call mistakes.
 *
 * Runs as the lean tool's `prepareArguments`, before pi validates the
 * arguments against the lean schema:
 *
 * - the model calls the tool with upstream's `action` parameter instead of `op`
 *   (the exact upstream interface is what op `help` prints, so this mistake is
 *   expected right after reading it);
 * - the model uses a supervisor `reason` value or the upstream tool name as the op;
 * - the model passes `attachments`/`interview` as a real array/object instead of
 *   the JSON string the lean schema declares.
 *
 * Everything here must be a guess that cannot be wrong. Anything ambiguous
 * throws; pi turns that into an error tool result the model can act on.
 */

export const INTERCOM_ACTIONS = [
  "list",
  "list-cwd",
  "send",
  "ask",
  "handover",
  "reply",
  "pending",
  "status",
  "cancel",
] as const;

export const SUPERVISOR_REASONS = ["need_decision", "progress_update", "interview_request"] as const;

export type IntercomAction = (typeof INTERCOM_ACTIONS)[number];
export type SupervisorReason = (typeof SUPERVISOR_REASONS)[number];

/** Ops of the lean tool for a given mode; also the schema enum for `op`. */
export function leanOps(hasSupervisor: boolean): string[] {
  return [...INTERCOM_ACTIONS, ...(hasSupervisor ? (["supervisor"] as const) : []), "help"];
}

const JSON_PASS_THROUGH_FIELDS = ["attachments", "interview"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveActionToOp(action: string, hasSupervisor: boolean, args: Record<string, unknown>): string {
  if ((INTERCOM_ACTIONS as readonly string[]).includes(action) || action === "help") {
    return action;
  }
  // Upstream tool name or its op alias. When the supervisor tool is absent the
  // lean schema enum rejects "supervisor" and lists the valid ops.
  if (action === "supervisor" || action === "contact_supervisor") {
    return "supervisor";
  }
  if ((SUPERVISOR_REASONS as readonly string[]).includes(action)) {
    if (args.reason === undefined) args.reason = action;
    return "supervisor";
  }
  throw new Error(`Unknown op '${action}'. Valid ops: ${leanOps(hasSupervisor).join(", ")}.`);
}

export function fillInArguments(raw: unknown, hasSupervisor: boolean): Record<string, unknown> {
  if (!isPlainObject(raw)) return raw as Record<string, unknown>;
  const args: Record<string, unknown> = { ...raw };

  for (const field of JSON_PASS_THROUGH_FIELDS) {
    const value = args[field];
    if (Array.isArray(value) || isPlainObject(value)) {
      args[field] = JSON.stringify(value);
    }
  }

  const op = typeof args.op === "string" ? args.op : undefined;
  const action = typeof args.action === "string" ? args.action : undefined;
  delete args.action;

  if (action !== undefined) {
    if (op !== undefined && op !== action) {
      throw new Error(
        `Both 'op' and 'action' given with different values ('${op}' vs '${action}'); pass only 'op'.`,
      );
    }
    if (op === undefined) {
      args.op = resolveActionToOp(action, hasSupervisor, args);
    }
    // action === op: same intent, already carried by op.
  }

  // A help-guided call that used the upstream reason value as the op.
  if (
    typeof args.op === "string" &&
    (SUPERVISOR_REASONS as readonly string[]).includes(args.op) &&
    args.reason === undefined
  ) {
    args.reason = args.op;
    args.op = "supervisor";
  }
  if (args.op === "contact_supervisor") {
    args.op = "supervisor";
  }

  return args;
}
