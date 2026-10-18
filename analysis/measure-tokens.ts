/**
 * Measures how many characters and tokens the upstream pi-intercom tool
 * declarations take versus the lean ones, for both session modes.
 *
 * Tokens use the o200k_base encoding (js-tiktoken, `encoding_for_model("gpt-4o")`).
 * Other providers' tokenizers differ slightly, but the ratio is stable.
 *
 * Run with: npm run measure
 */

import { encodingForModel } from "js-tiktoken";
import { buildLeanTool, INTERCOM_TOOL_NAME, SUPERVISOR_TOOL_NAME, type UpstreamTool } from "../lean/tool.ts";
import { loadUpstreamTools } from "../test/helpers.ts";

const enc = encodingForModel("gpt-4o");
const tokens = (s: string) => enc.encode(s).length;
const chars = (s: string) => s.length;

const fmt = (n: number) => n.toLocaleString("en-US");

type Row = {
  name: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
};

function declaration(r: Row) {
  // What the model reads in the tools list on every request.
  return `${r.description}\n${JSON.stringify(r.parameters)}`;
}

function promptExtras(r: Row) {
  // What pi adds to the system prompt (snippet + guidelines).
  return [r.promptSnippet ?? "", ...(r.promptGuidelines ?? [])].join("\n");
}

function rowsFor(tools: Map<string, UpstreamTool>): Row[] {
  return [...tools.values()].map((t) => ({
    name: t.name,
    description: t.description,
    promptSnippet: t.promptSnippet,
    promptGuidelines: t.promptGuidelines,
    parameters: t.parameters,
  }));
}

function leanRow(mode: "main" | "subagent", tools: Map<string, UpstreamTool>): Row {
  const lean = buildLeanTool(tools) as unknown as Row;
  lean.name = `intercom (lean, ${mode})`;
  return lean;
}

function table(title: string, upstream: Row[], lean: Row) {
  console.log(`\n## ${title}\n`);
  console.log("| Tool | Description (chars/toks) | Parameters (chars/toks) | Snippet+guidelines (chars/toks) | Declaration total (toks) |");
  console.log("|---|---|---|---|---|");
  let upstreamTokens = 0;
  for (const r of upstream) {
    const c = chars(r.description);
    const t = tokens(r.description);
    const pc = chars(JSON.stringify(r.parameters));
    const pt = tokens(JSON.stringify(r.parameters));
    const sc = chars(promptExtras(r));
    const st = tokens(promptExtras(r));
    upstreamTokens += t + pt + st;
    console.log(`| ${r.name} | ${fmt(c)} / ${fmt(t)} | ${fmt(pc)} / ${fmt(pt)} | ${fmt(sc)} / ${fmt(st)} | ${fmt(t + pt + st)} |`);
  }
  const c = chars(lean.description);
  const t = tokens(lean.description);
  const pc = chars(JSON.stringify(lean.parameters));
  const pt = tokens(JSON.stringify(lean.parameters));
  const sc = chars(promptExtras(lean));
  const st = tokens(promptExtras(lean));
  const leanTokens = t + pt + st;
  console.log(`| ${lean.name} | ${fmt(c)} / ${fmt(t)} | ${fmt(pc)} / ${fmt(pt)} | ${fmt(sc)} / ${fmt(st)} | ${fmt(leanTokens)} |`);
  const saved = upstreamTokens - leanTokens;
  const pct = Math.round((saved / upstreamTokens) * 100);
  console.log(`\nUpstream total: **${fmt(upstreamTokens)} tokens**; lean total: **${fmt(leanTokens)} tokens**; saved: **${fmt(saved)} tokens (${pct}%).\n`);
  return { upstreamTokens, leanTokens };
}

const mainUpstream = await loadUpstreamTools("main");
const subagentUpstream = await loadUpstreamTools("subagent");

const main = table("Main session (upstream: intercom only)", rowsFor(mainUpstream), leanRow("main", mainUpstream));
const sub = table("Subagent session (upstream: intercom + contact_supervisor)", rowsFor(subagentUpstream), leanRow("subagent", subagentUpstream));

console.log("## Notes\n");
console.log("- Tokens: o200k_base (gpt-4o). Declaration = description + parameters JSON, sent with every request that lists tools; snippet + guidelines land in the system prompt.");
console.log(`- Upstream registers ${mainUpstream.size} tool(s) in main sessions and ${subagentUpstream.size} in subagent sessions; lean always registers 1 (op \`help\` reprints the full upstream docs on demand).`);
console.log(`- contact_supervisor present: ${[...subagentUpstream.keys()].includes(SUPERVISOR_TOOL_NAME)}; intercom present: ${[...mainUpstream.keys()].includes(INTERCOM_TOOL_NAME)}.`);
