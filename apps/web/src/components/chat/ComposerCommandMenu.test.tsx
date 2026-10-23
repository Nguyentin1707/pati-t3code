import { describe, expect, it } from "vite-plus/test";

import { ProviderDriverKind } from "@t3tools/contracts";

import {
  composerSuggestionOptionId,
  groupComposerCommandItems,
  orderComposerCommandItemsByGroup,
  type ComposerCommandItem,
} from "./ComposerCommandMenu";

describe("composerSuggestionOptionId", () => {
  it("keeps whitespace, escape-like paths, and malformed UTF-16 distinct", () => {
    const paths = [
      "docs/my file.md",
      "docs/my_file.md",
      "docs/my%20file.md",
      "docs/my\tfile.md",
      "docs/\ud800.md",
      "docs/\ud801.md",
      "docs/\udc00.md",
      "docs/\ufffd.md",
      "docs/\\ud800.md",
      "docs/\ud83d\ude80.md",
    ];
    const ids = paths.map((path) => composerSuggestionOptionId("suggestions", `path:file:${path}`));

    expect(new Set(ids).size).toBe(paths.length);
    for (const id of ids) expect(id).not.toMatch(/\s|[\ud800-\udfff]/u);
    expect(composerSuggestionOptionId("other-composer", paths[0]!)).not.toBe(
      composerSuggestionOptionId("suggestions", paths[0]!),
    );
  });
});

describe("slash menu groups", () => {
  const codex = ProviderDriverKind.make("codex");
  const builtIn = (command: "model" | "plan"): ComposerCommandItem => ({
    id: `slash:${command}`,
    type: "slash-command",
    command,
    label: `/${command}`,
    description: "",
  });
  const providerCommand = (name: string): ComposerCommandItem => ({
    id: `provider-slash-command:codex:${name}`,
    type: "provider-slash-command",
    provider: codex,
    command: { name },
    label: `/${name}`,
    description: "",
  });
  const skill = (name: string): ComposerCommandItem => ({
    id: `skill:codex:${name}`,
    type: "skill",
    provider: codex,
    skill: { name, path: `/skills/${name}`, enabled: true },
    label: `/skill:${name}`,
    description: "",
  });

  it("splits ranked items into labelled groups and keeps the ranking inside each group", () => {
    const ranked = [
      skill("b"),
      providerCommand("review"),
      builtIn("plan"),
      skill("a"),
      builtIn("model"),
      providerCommand("init"),
    ];

    const groups = groupComposerCommandItems(ranked);

    expect(groups.map((group) => group.label)).toEqual(["T3 Code", "Codex commands", "Skills"]);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["slash:plan", "slash:model"],
      ["provider-slash-command:codex:review", "provider-slash-command:codex:init"],
      ["skill:codex:b", "skill:codex:a"],
    ]);
  });

  it("orders items for arrow-key navigation exactly as the groups render them", () => {
    const ranked = [skill("a"), builtIn("model"), providerCommand("init")];

    expect(orderComposerCommandItemsByGroup(ranked).map((item) => item.id)).toEqual([
      "slash:model",
      "provider-slash-command:codex:init",
      "skill:codex:a",
    ]);
  });

  it("omits empty groups and leaves non-slash menus as one unlabelled group", () => {
    expect(groupComposerCommandItems([builtIn("model")]).map((group) => group.label)).toEqual([
      "T3 Code",
    ]);
    const files: ComposerCommandItem[] = [
      {
        id: "path:file:a.ts",
        type: "path",
        path: "a.ts",
        pathKind: "file",
        searchTarget: { kind: "cwd", cwd: "/repo" } as never,
        label: "a.ts",
        description: "",
      },
    ];
    expect(groupComposerCommandItems(files)).toEqual([{ key: "all", label: null, items: files }]);
  });
});
