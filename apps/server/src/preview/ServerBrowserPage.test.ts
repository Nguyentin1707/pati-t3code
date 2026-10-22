import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "playwright-core";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import * as ServerBrowserPage from "./ServerBrowserPage.ts";

describe("server browser element refs", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let cdp: CDPSession;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  beforeEach(async () => {
    context = await browser.newContext();
    page = await context.newPage();
    cdp = await context.newCDPSession(page);
  });
  afterEach(async () => {
    await context.close();
  });

  const takeSnapshot = () =>
    ServerBrowserPage.snapshot({
      page,
      cdp,
      renderScale: 1,
      consoleEntries: [],
      networkEntries: [],
      actionTimeline: [],
    });
  const locators = (tree: unknown) => {
    expect(typeof tree).toBe("string");
    return Array.from(
      String(tree).matchAll(/\[ref=([^\]]+)\]/g),
      (match) => `aria-ref=${match[1]}`,
    );
  };
  const buttonLocator = (tree: unknown, name: string) => {
    const line = String(tree)
      .split("\n")
      .find((line) => line.includes(`button "${name}"`));
    const locator = locators(line)[0];
    expect(locator).toBeDefined();
    return locator!;
  };
  const repeatedRows = `<ul>${Array.from({ length: 5 }, (_, i) => `<li>row ${i + 1}<button data-testid="delete-row" onclick="this.parentElement.remove()">delete</button></li>`).join("")}</ul>`;

  it("clicks the fifth repeated delete control without touching row one", async () => {
    await page.setContent(repeatedRows);
    const result = await takeSnapshot();
    const buttons = String(result.accessibilityTree)
      .split("\n")
      .filter((line) => line.includes('button "delete"'));
    expect(buttons).toHaveLength(5);
    await ServerBrowserPage.click(page, { locator: locators(buttons[4])[0]!, timeoutMs: 1_000 });
    expect(await page.locator("li").allTextContents()).toEqual([
      "row 1delete",
      "row 2delete",
      "row 3delete",
      "row 4delete",
    ]);
  });

  it("returns from a click once it opens a dialog", async () => {
    await page.setContent(
      `<button onclick="document.body.dataset.answer = String(confirm('sure?'))">Confirm</button>`,
    );
    const dialog = new Promise<import("playwright-core").Dialog>((resolve) =>
      page.once("dialog", resolve),
    );
    await ServerBrowserPage.click(page, {
      locator: buttonLocator((await takeSnapshot()).accessibilityTree, "Confirm"),
      timeoutMs: 1_000,
    });
    await (await dialog).accept();
    await expect.poll(() => page.locator("body").getAttribute("data-answer")).toBe("true");
  });

  it("rejects ambiguous CSS controls without clicking any row", async () => {
    await page.setContent(repeatedRows);
    await expect(
      ServerBrowserPage.click(page, {
        selector: 'button[data-testid="delete-row"]',
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow(/strict mode violation/);
    expect(await page.locator("li").count()).toBe(5);
  });

  it("reports how many elements an ambiguous locator matched", async () => {
    await page.setContent(repeatedRows);
    const failure = await ServerBrowserPage.click(page, {
      selector: 'button[data-testid="delete-row"]',
      timeoutMs: 1_000,
    }).catch(ServerBrowserPage.toOperationError);
    expect(failure).toMatchObject({
      tag: "PreviewAutomationInvalidSelectorError",
      detail: { hint: "ambiguous", matchCount: 5 },
    });
  });

  it.each([
    {
      hint: "covered",
      html: '<button id="go">Go</button><div style="position:fixed;inset:0;background:#fff"></div>',
    },
    { hint: "notEnabled", html: '<button id="go" disabled>Go</button>' },
    { hint: "notVisible", html: '<button id="go" style="display:none">Go</button>' },
  ])("hints $hint when a click cannot reach its target", async ({ hint, html }) => {
    await page.setContent(html);
    const failure = await ServerBrowserPage.click(page, {
      selector: "#go",
      timeoutMs: 300,
    }).catch(ServerBrowserPage.toOperationError);
    expect(failure).toMatchObject({
      tag: "PreviewAutomationTimeoutError",
      detail: { hint },
    });
  });

  it("names the conditions a wait left unmet", async () => {
    await page.setContent("<p>hello</p>");
    const failure = await ServerBrowserPage.waitFor(page, {
      text: "hello",
      urlIncludes: "never-matches",
      selector: "#missing",
      timeoutMs: 150,
    }).catch(ServerBrowserPage.toOperationError);
    expect(failure).toMatchObject({
      tag: "PreviewAutomationTimeoutError",
      detail: { unmet: ["locator", "url"] },
    });
  });

  it("does not treat a hidden element as visible", async () => {
    await page.setContent('<p id="late" style="display:none">late</p>');
    const failure = await ServerBrowserPage.waitFor(page, {
      selector: "#late",
      timeoutMs: 150,
    }).catch(ServerBrowserPage.toOperationError);
    expect(failure).toMatchObject({
      tag: "PreviewAutomationTimeoutError",
      detail: { unmet: ["locator"] },
    });
  });

  it("waits for a spinner removed by a click to be hidden", async () => {
    await page.setContent(
      "<div id=\"spinner\">loading</div><button onclick=\"document.getElementById('spinner').style.display='none'\">done</button>",
    );
    const waiting = ServerBrowserPage.waitFor(page, {
      selector: "#spinner",
      state: "hidden",
      timeoutMs: 5_000,
    });
    await page.click("button");
    await waiting;
  });

  it("waits for text to disappear when the state is hidden", async () => {
    await page.setContent("<p>Saving…</p>");
    const waiting = ServerBrowserPage.waitFor(page, {
      text: "Saving…",
      state: "hidden",
      timeoutMs: 5_000,
    });
    await page.evaluate("document.querySelector('p').remove()");
    await waiting;
  });

  it("names the locator as unmet while an element stays visible", async () => {
    await page.setContent('<div id="spinner">loading</div>');
    const failure = await ServerBrowserPage.waitFor(page, {
      selector: "#spinner",
      state: "hidden",
      timeoutMs: 150,
    }).catch(ServerBrowserPage.toOperationError);
    expect(failure).toMatchObject({
      tag: "PreviewAutomationTimeoutError",
      detail: { unmet: ["locator"] },
    });
  });

  it("stops waiting when control of the tab changes hands", async () => {
    await page.setContent("<p>hello</p>");
    const control = { generation: 0 };
    const waiting = ServerBrowserPage.waitFor(
      page,
      { selector: "#missing", timeoutMs: 5_000 },
      undefined,
      control,
    );
    control.generation++;
    await expect(waiting).rejects.toMatchObject({ reason: "interrupted" });
  });

  it("does not retarget a removed ref to a replacement node", async () => {
    await page.setContent("<button onclick=\"this.textContent='clicked'\">original</button>");
    const locator = buttonLocator((await takeSnapshot()).accessibilityTree, "original");
    await page.setContent("<button onclick=\"this.textContent='clicked'\">replacement</button>");
    await expect(ServerBrowserPage.click(page, { locator, timeoutMs: 100 })).rejects.toThrow();
    expect(await page.locator("button").textContent()).toBe("replacement");
  });

  it("targets iframe input refs and preserves the parent form", async () => {
    await page.setContent(
      '<input aria-label="parent"><iframe srcdoc="<input aria-label=child>"></iframe>',
    );
    await page.frameLocator("iframe").getByRole("textbox").waitFor();
    const result = await takeSnapshot();
    const line = String(result.accessibilityTree)
      .split("\n")
      .find((line) => line.includes('textbox "child"'));
    const locator = locators(line)[0]!;
    await ServerBrowserPage.type(page, { locator, text: "inside iframe", clear: true });
    expect(await page.frameLocator("iframe").getByRole("textbox").inputValue()).toBe(
      "inside iframe",
    );
    expect(await page.getByRole("textbox", { name: "parent" }).inputValue()).toBe("");
  });

  it("shows dotted fields as dots wherever their value appears, keeping text values and refs", async () => {
    await page.setContent(`
      <table><tr><td>password:</td><td><input id="pw" type="password" aria-label="Password"></td></tr></table>
      <input aria-label="Username" value="maria">
      <input type="password" aria-label='saved" [ref=e2]: x' placeholder="hint" value="saved-pass">
      <input type="password" role="combobox" aria-label="Code" value="role-pass">
      <input aria-label="PIN" style="-webkit-text-security: disc" value="styled-pass">
      <div contenteditable style="-webkit-text-security: disc">editable-pass</div>
      <iframe srcdoc="<input type=password aria-label=child value=frame-pass>"></iframe>
      <iframe id="blank" src="javascript:false"></iframe>
      <p>Order styled-pass-2</p>
      <script>
        // A frame that never commits a document, filled by its parent.
        blank.contentDocument.body.innerHTML = "<input type=password aria-label=blank value=blank-pass>";
        // Page script can't change the value the snapshot sees.
        Object.defineProperty(HTMLInputElement.prototype, "value", { get: () => "" });
      </script>`);
    await page.frameLocator("iframe[srcdoc]").getByRole("textbox").waitFor();
    await ServerBrowserPage.type(page, { locator: "#pw", text: "typed-pass" });
    const result = await takeSnapshot();
    const tree = String(result.accessibilityTree);
    expect(tree).toContain('textbox "blank"');
    expect(tree).not.toMatch(
      /typed-pass|saved-pass|role-pass|styled-pass|editable-pass|frame-pass|blank-pass/,
    );
    expect(result.visibleText).not.toContain("editable-pass");
    // Page text masks the same values, so it can't be compared against the tree.
    expect(result.visibleText).toContain("Order ••••••••-2");
    expect(tree).toMatch(/row "password: •+"/);
    expect(tree).toMatch(/textbox "Username" [^\n]*: maria$/m);
    const line = tree.split("\n").find((line) => line.includes('textbox "Password"'));
    expect(line).toMatch(/: •+$/);
    await ServerBrowserPage.type(page, { locator: locators(line)[0]!, text: "next", clear: true });
    expect(await page.locator("#pw").inputValue()).toBe("next");
  });

  it("masks dotted values in page text next to punctuation, with odd spaces, and at the cut", async () => {
    await page.setContent(`
      <input type="password" aria-label="PIN" value="123">
      <input type="password" aria-label="Phrase" value="open&nbsp;sesame">
      <p>PIN: 123. Code (123) id 1234</p>
      <p>open&nbsp;sesame</p>`);
    const text = (await takeSnapshot()).visibleText;
    expect(text).toContain("PIN: ••••••••. Code (••••••••) id 1234");
    expect(text).not.toMatch(/open|sesame/);
    await page.setContent(`
      <p>${"x".repeat(19_995)}long-secret</p>
      <input type="password" aria-label="Long" value="long-secret">`);
    const cut = (await takeSnapshot()).visibleText;
    expect(cut.length).toBe(20_000);
    // Masked before the cut, so no prefix of the value is left.
    expect(cut.slice(-8)).toBe("xxx•••••");
  });

  it("shows a data: link or blocked data: navigation by media type only", async () => {
    // Chromium keeps raw spaces and quotes in both, so a payload can't be cut at either.
    await page.setContent(`
      <a download href="data:text/plain;charset=&quot;a,b&quot;,head PAYLOAD'tail">Key</a>
      <a href="https://example.com/data:report,2026">Report</a>
      <a href="#">data:text/plain,label</a>
      <a href='"data:text/plain,relative'>Relative</a>
      <a href=" data:text/plain,PAYLOAD">Spaced</a>
      <a href="da&#9;ta:text/plain,PAYLOAD">Tabbed</a>
      <a href="data:text/plain,head&#x2028;PAYLOAD">Separated</a>
      <a href="data:PAYLOAD,x">Typeless</a>
      <a href="&#11;data:text/plain,PAYLOAD">Vertical tab</a>
      <a href="&#8;data:text/plain,PAYLOAD">Backspace</a>
      <a id="controlled">Controlled</a>
      <a id="escaped">Escaped</a>
      <script>
        controlled.href = "\\x01data:text/plain,PAYLOAD";
        escaped.href = "\\x02da\\tta:text/plain,PAYLOAD";
      </script>`);
    const tree = String((await takeSnapshot()).accessibilityTree);
    expect(tree.match(/\/url: data:text\/plain,…$/gm)).toHaveLength(8);
    expect(tree).toContain("/url: data:,…");
    expect(tree).toContain("/url: https://example.com/data:report,2026");
    expect(tree).toMatch(/link "data:text\/plain,label" \[ref=t3-/);
    expect(tree).not.toMatch(/PAYLOAD|tail|charset|\u2028/);
    expect(tree).toContain('/url: "\\"data:text/plain,relative"');
  });

  it("redacts a data: link whose scheme a password value would mask", async () => {
    await page.setContent(`
      <input type="password" aria-label="Scheme" value="data">
      <a download href="data:text/plain,PAYLOAD">Key</a>`);
    const tree = String((await takeSnapshot()).accessibilityTree);
    expect(tree).toContain("/url: ••••••••:text/plain,…");
    expect(tree).not.toContain("PAYLOAD");
  });

  it("rejects refs from another tab", async () => {
    await page.setContent("<button>same label</button>");
    const locator = buttonLocator((await takeSnapshot()).accessibilityTree, "same label");
    const other = await context.newPage();
    await other.setContent("<button>same label</button>");
    await expect(ServerBrowserPage.click(other, { locator })).rejects.toThrow(/another tab/);
  });

  it("revokes refs after navigation even when labels are identical", async () => {
    await page.goto("data:text/html,<button>continue</button>");
    const locator = buttonLocator((await takeSnapshot()).accessibilityTree, "continue");
    await page.goto("data:text/html,<button>continue</button><p>new document</p>");
    await expect(ServerBrowserPage.click(page, { locator })).rejects.toThrow(/stale/);
  });

  it.each(["aria-ref=e1", " aria-ref=e1", "css=body >> aria-ref=e1"])(
    "does not allow native refs to bypass generation validation (%s)",
    async (locator) => {
      await page.setContent("<button>continue</button>");
      await takeSnapshot();
      await expect(ServerBrowserPage.click(page, { locator })).rejects.toThrow(/stale/);
    },
  );

  it("preserves quoted attribute values containing ref engine text", async () => {
    await page.setContent(
      '<button data-example=" >> aria-ref=e1" onclick="this.textContent=\'saved\'">save</button>',
    );
    await ServerBrowserPage.click(page, { selector: 'button[data-example=" >> aria-ref=e1"]' });
    expect(await page.locator("button").textContent()).toBe("saved");
  });
});

describe("server browser drag", () => {
  it("fails the drag, not the server, when it times out while the cursor is still moving", async () => {
    const timedOut = new Error("locator.dragTo: Timeout 30000ms exceeded.");
    const box = { x: 0, y: 0, width: 20, height: 20 };
    const targetBox = Promise.withResolvers<typeof box>();
    const page = {
      locator: (selector: string) =>
        selector === "#card"
          ? {
              scrollIntoViewIfNeeded: async () => {},
              boundingBox: async () => box,
              dragTo: () => Promise.reject(timedOut),
            }
          : { boundingBox: () => targetBox.promise },
    } as unknown as Page;
    const unobserved: Array<unknown> = [];
    const onUnhandled = (reason: unknown) => unobserved.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      let finished = false;
      const settled = ServerBrowserPage.drag(page, { source: "#card", target: "#lane" }).then(
        () => null,
        (error: unknown) => error,
      );
      void settled.then(() => (finished = true));
      // Two macrotask turns: Node reports a rejection nobody observed after the first.
      for (let turn = 0; turn < 2; turn++) {
        // oxlint-disable-next-line t3code/no-real-time-wait-in-tests -- Node emits unhandledRejection only between macrotasks; no promise can mark that point.
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(finished).toBe(false);
      targetBox.resolve(box);

      expect(await settled).toBe(timedOut);
      expect(unobserved).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("server browser request deadline", () => {
  const fakeTarget = () => {
    const locator = {
      scrollIntoViewIfNeeded: vi.fn(async (_options: { timeout: number }) => {}),
      boundingBox: vi.fn(async (_options: { timeout: number }) => ({
        x: 0,
        y: 0,
        width: 20,
        height: 20,
      })),
      click: vi.fn(async (_options: { timeout: number }) => {}),
      hover: vi.fn(async (_options: { timeout: number }) => {}),
      fill: vi.fn(async (_text: string, _options: { timeout: number }) => {}),
      evaluate: vi.fn(async (_run: unknown, _arg: unknown, _options: { timeout: number }) => {}),
    };
    const page = {
      locator: () => locator,
      once: () => {},
      off: () => {},
      viewportSize: () => ({ width: 100, height: 100 }),
    } as unknown as Page;
    return { page, locator };
  };
  const timeoutsOf = (...calls: ReadonlyArray<ReadonlyArray<ReadonlyArray<unknown>>>) =>
    calls.flat().map((args) => (args.at(-1) as { timeout: number }).timeout);

  it("gives every click step only the time the request has left", async () => {
    using _now = vi.spyOn(performance, "now").mockReturnValue(10_000);
    const { page, locator } = fakeTarget();
    const pointer = vi.fn(async () => {});
    await ServerBrowserPage.click(page, { locator: "#go" }, pointer, 12_000);

    const timeouts = timeoutsOf(
      locator.scrollIntoViewIfNeeded.mock.calls,
      locator.boundingBox.mock.calls,
      locator.click.mock.calls,
    );
    expect(timeouts).toHaveLength(3);
    for (const timeout of timeouts) {
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThan(2_000);
    }
    expect(pointer).toHaveBeenCalledOnce();
  });

  it("skips the cursor animation when too little time is left to play it", async () => {
    using _now = vi.spyOn(performance, "now").mockReturnValue(10_000);
    const { page, locator } = fakeTarget();
    const pointer = vi.fn(async () => {});
    await ServerBrowserPage.click(page, { locator: "#go" }, pointer, 10_600);
    await ServerBrowserPage.hover(page, { locator: "#go" }, pointer, 10_600);

    expect(pointer).not.toHaveBeenCalled();
    expect(locator.click).toHaveBeenCalledOnce();
    expect(locator.hover).toHaveBeenCalledOnce();
  });

  it("never hands Playwright a zero timeout, which it reads as no timeout", async () => {
    using _now = vi.spyOn(performance, "now").mockReturnValue(10_000);
    const { page, locator } = fakeTarget();
    await ServerBrowserPage.click(page, { locator: "#go" }, undefined, 9_000);

    for (const timeout of timeoutsOf(
      locator.scrollIntoViewIfNeeded.mock.calls,
      locator.boundingBox.mock.calls,
      locator.click.mock.calls,
    )) {
      expect(timeout).toBeGreaterThan(0);
    }
  });

  it("bounds typing and scrolling by the same deadline", async () => {
    using _now = vi.spyOn(performance, "now").mockReturnValue(10_000);
    const { page, locator } = fakeTarget();
    await ServerBrowserPage.type(page, { locator: "#name", text: "a", clear: true }, 12_000);
    await ServerBrowserPage.scroll(page, { locator: "#list", deltaY: 40 }, 12_000);

    for (const timeout of timeoutsOf(locator.fill.mock.calls, locator.evaluate.mock.calls)) {
      expect(timeout).toBeGreaterThan(0);
      expect(timeout).toBeLessThan(2_000);
    }
  });
});
