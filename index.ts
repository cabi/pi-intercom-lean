/**
 * pi-intercom-lean entry point.
 *
 * Runs upstream pi-intercom against a Proxy around the real `pi` object:
 *
 * - registerTool calls are collected instead of registered, so upstream's tool
 *   list never reaches the model directly and cannot change mid-session (the
 *   proxy keeps swallowing registerTool even for calls upstream makes later
 *   from event handlers);
 * - setActiveTools is blocked (upstream does not call it as of 0.18.0; this is
 *   defensive, to guarantee a fixed tool list);
 * - everything else (commands, key bindings, overlays, events, appendEntry,
 *   session hooks) passes through untouched, so every non-tool feature behaves
 *   exactly like upstream.
 *
 * After upstream initializes, the collected tools are wrapped into one lean
 * `intercom` tool (see lean/tool.ts) and registered.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import upstreamExtension from "pi-intercom";
import { fillInArguments } from "./lean/fill-ins.ts";
import { buildLeanTool, type UpstreamTool } from "./lean/tool.ts";

const LOG_PREFIX = "[pi-intercom-lean]";

/**
 * Wraps `pi` so upstream tool registrations are collected. Exported for tests.
 * The returned proxy stays functional for upstream's lifetime (event handlers
 * keep a reference to it), so late registerTool/setActiveTools calls are
 * swallowed the same way.
 */
export function makeCollectingProxy(pi: ExtensionAPI): { pi: ExtensionAPI; tools: Map<string, UpstreamTool> } {
  const upstreamTools = new Map<string, UpstreamTool>();
  const proxy = new Proxy(pi, {
    get(target, prop) {
      if (prop === "registerTool") {
        return (tool: UpstreamTool) => {
          upstreamTools.set(tool.name, tool);
        };
      }
      if (prop === "setActiveTools") {
        return () => {
          console.error(`${LOG_PREFIX} blocked setActiveTools(); the tool list is fixed for the session.`);
        };
      }
      const value = Reflect.get(target, prop, target);
      return value;
    },
  });
  return { pi: proxy, tools: upstreamTools };
}

export default function piIntercomLeanExtension(pi: ExtensionAPI): void {
  const { pi: proxy, tools: upstreamTools } = makeCollectingProxy(pi);
  upstreamExtension(proxy as Parameters<typeof upstreamExtension>[0]);
  pi.registerTool(buildLeanTool(upstreamTools));
}

export { fillInArguments };
