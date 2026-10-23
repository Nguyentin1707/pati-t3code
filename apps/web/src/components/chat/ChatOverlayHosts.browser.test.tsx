import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { act, render } from "../../../test/render";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { openRevertConfirm, RevertConfirmHost } from "./ChatOverlayHosts";

it("rolls back a checkpoint only after the in-app confirm", async () => {
  const onRollback = vi.fn();
  await using _screen = await render(
    <AppAtomRegistryProvider>
      <RevertConfirmHost threadKey="env:thread-rollback" onConfirm={() => {}} />
    </AppAtomRegistryProvider>,
  );
  await act(async () =>
    openRevertConfirm("env:thread-rollback", { kind: "checkpoint", onRollback, onFork: null }),
  );
  await expect.element(page.getByText(/network calls are not undone/)).toBeInTheDocument();
  expect(onRollback).not.toHaveBeenCalled();
  await expect.element(page.getByText("Fork from here instead")).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Roll back" }).click();
  expect(onRollback).toHaveBeenCalledTimes(1);
});

it("offers to fork instead of rolling back", async () => {
  const onRollback = vi.fn();
  const onFork = vi.fn();
  await using _screen = await render(
    <AppAtomRegistryProvider>
      <RevertConfirmHost threadKey="env:thread-fork" onConfirm={() => {}} />
    </AppAtomRegistryProvider>,
  );
  await act(async () =>
    openRevertConfirm("env:thread-fork", { kind: "checkpoint", onRollback, onFork }),
  );
  await page.getByRole("button", { name: "Fork from here instead" }).click();
  expect(onFork).toHaveBeenCalledTimes(1);
  expect(onRollback).not.toHaveBeenCalled();
});
