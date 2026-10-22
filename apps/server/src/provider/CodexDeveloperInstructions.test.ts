import * as NodeAssert from "node:assert/strict";

import {
  T3_CODE_ORCHESTRATION_INSTRUCTIONS,
  T3_CODE_ORCHESTRATION_SECTIONS,
  t3ToolInstructions,
} from "@t3tools/provider-core/server/orchestrationInstructions";
import { describe, it } from "vite-plus/test";

import {
  buildCodexAdditionalContext,
  CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
} from "./CodexDeveloperInstructions.ts";

describe("buildCodexAdditionalContext", () => {
  describe.each([
    { model: "gpt-5.3-codex", reasoningEffort: "high" },
    { model: "custom-model", modelName: "Custom 🦊 Model", reasoningEffort: "xhigh" },
  ])("with runtime $model", (runtime) => {
    it.each([
      undefined,
      false,
      true,
      { browser: false, device: false },
      { browser: true, device: false },
      { browser: false, device: true },
      { browser: true, device: true },
    ])("keeps every entry within Codex's per-entry cap with tools %j", (availability) => {
      const context = buildCodexAdditionalContext(runtime, availability);

      for (const [key, entry] of Object.entries(context)) {
        // Codex counts ceil(UTF-8 bytes / 4) tokens, excluding keys and wrappers.
        const bytes = Buffer.byteLength(entry.value, "utf8");
        const limit = CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES;
        NodeAssert.ok(
          bytes <= limit,
          `${key}: ${bytes} UTF-8 bytes exceeds Codex's ${limit}-byte per-entry cap by ${bytes - limit} bytes; split the instructions into separate entries to avoid silent truncation`,
        );
      }
    });
  });

  it("delivers all orchestration sections in authored order when keys are sorted", () => {
    const context = buildCodexAdditionalContext({
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
    });
    const sections = Object.keys(context)
      .filter((key) => key.startsWith("t3_code_orchestration_"))
      .sort()
      .map((key) => context[key]!);

    NodeAssert.deepEqual(
      sections,
      T3_CODE_ORCHESTRATION_SECTIONS.map((value) => ({ kind: "application", value })),
    );
    NodeAssert.equal(
      sections.map((entry) => entry.value).join("\n\n"),
      T3_CODE_ORCHESTRATION_INSTRUCTIONS.trim(),
    );
  });
});

describe("Codex tool instructions", () => {
  const toolsEntry = (availability: Parameters<typeof buildCodexAdditionalContext>[1]) =>
    buildCodexAdditionalContext({ model: "gpt-5.3-codex" }, availability).t3_code_tools?.value;

  it("adds each tool section only for the capability the turn has", () => {
    NodeAssert.equal(toolsEntry({ browser: false, device: false }), undefined);
    NodeAssert.match(
      toolsEntry({ browser: true, device: false }) ?? "",
      /T3 Code collaborative browser/,
    );
    NodeAssert.doesNotMatch(toolsEntry({ browser: true, device: false }) ?? "", /T3 Code devices/);
    NodeAssert.match(toolsEntry({ browser: false, device: true }) ?? "", /^## T3 Code devices/);
    NodeAssert.doesNotMatch(
      toolsEntry({ browser: false, device: true }) ?? "",
      /collaborative browser/,
    );
    NodeAssert.equal(
      toolsEntry({ browser: true, device: true }),
      [
        t3ToolInstructions({ browser: true, device: false }),
        t3ToolInstructions({ browser: false, device: true }),
      ].join("\n\n"),
    );
  });

  it("tells the agent how to read action results, wait for hidden, and follow error hints", () => {
    const browser = toolsEntry(true) ?? "";
    NodeAssert.match(browser, /`page`/);
    NodeAssert.match(browser, /`openedTabs`/);
    NodeAssert.match(browser, /state: "hidden"/);
    NodeAssert.match(browser, /error names the cause and the next step/);
  });
});

describe("buildCodexDeveloperInstructions", () => {
  it("flattens multiline metadata into single-line runtime info", () => {
    const instructions = runtimeInstructions({
      model: "gpt\n5.3\ncodex",
      reasoningEffort: " high\neffort ",
    });

    NodeAssert.match(instructions, /as gpt 5\.3 codex with high effort reasoning effort/);
    NodeAssert.doesNotMatch(instructions, /<runtime_info>[^<]*\n/);
  });
});

function runtimeInstructions(runtime: Parameters<typeof buildCodexAdditionalContext>[0]) {
  return buildCodexAdditionalContext(runtime).t3_code_runtime!.value;
}
