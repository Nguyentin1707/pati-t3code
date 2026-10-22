import { assert, describe, it } from "vite-plus/test";

import {
  t3AcpPromptWithInstructions,
  t3OrchestrationPromptForFirstRun,
  t3OrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";

const BROWSER_SECTION = "T3 Code collaborative browser";

describe("browser tool instructions", () => {
  describe("ACP prompt", () => {
    const state = { interactionMode: "default", hasT3Mcp: true, browser: true } as const;

    it("includes the browser section only when the thread has browser access", () => {
      const withBrowser = t3AcpPromptWithInstructions({ prompt: "Go.", state });
      const withoutBrowser = t3AcpPromptWithInstructions({
        prompt: "Go.",
        state: { ...state, browser: false },
      });

      assert.include(withBrowser, BROWSER_SECTION);
      assert.notInclude(withoutBrowser, BROWSER_SECTION);
      assert.include(withoutBrowser, "T3 Code orchestration");
    });

    it("re-sends instructions when browser access changes but not when nothing changed", () => {
      const prompt = t3AcpPromptWithInstructions({
        prompt: "Go.",
        state: { ...state, browser: false },
        previousState: state,
      });
      assert.notEqual(prompt, "Go.");
      assert.equal(
        t3AcpPromptWithInstructions({ prompt: "Go.", state, previousState: state }),
        "Go.",
      );
    });
  });

  it("gates the Cursor first-run prompt and the OpenCode system prompt on browser access", () => {
    const firstRun = (browser: boolean) =>
      t3OrchestrationPromptForFirstRun({ prompt: "Go.", runOrdinal: 1, hasT3Mcp: true, browser });

    assert.include(firstRun(true), BROWSER_SECTION);
    assert.notInclude(firstRun(false), BROWSER_SECTION);
    assert.include(t3OrchestrationSystemPrompt(true, true) ?? "", BROWSER_SECTION);
    assert.notInclude(t3OrchestrationSystemPrompt(true, false) ?? "", BROWSER_SECTION);
    assert.equal(t3OrchestrationSystemPrompt(false, true), undefined);
  });
});
