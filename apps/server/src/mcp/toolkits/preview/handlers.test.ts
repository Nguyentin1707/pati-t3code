import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  PreviewAutomationNoAvailableHostError,
  PreviewTabId,
  ProviderInstanceId,
  ThreadId,
  type PreviewAutomationStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  createPendingAttachmentId,
  parseThreadSegmentFromAttachmentId,
} from "../../../attachmentStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";
import { claimPreviewRecording, invokeTargeted } from "./handlers.ts";

const scope: McpInvocationContext.McpThreadInvocationScope = {
  environmentId: EnvironmentId.make("handlers-test-environment"),
  requestNamespace: "handlers-test",
  thread: {
    threadId: ThreadId.make("handlers-test-thread"),
    providerSessionId: "agent-a",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["preview"] as const),
  issuedAt: 1,
};

const baseStatus: PreviewAutomationStatus = {
  available: true,
  visible: true,
  tabId: PreviewTabId.make("tab-1"),
  url: "https://example.com/form",
  title: "Form",
  loading: false,
};

const runAction = (
  operation: "click" | "press",
  actionResult: unknown,
  status: PreviewAutomationStatus | "failure",
) =>
  invokeTargeted<object>(operation, {}).pipe(
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    Effect.provide(
      Layer.mock(PreviewAutomationBroker.PreviewAutomationBroker)({
        invoke: <A>(request: PreviewAutomationBroker.PreviewAutomationInvokeInput) =>
          request.operation !== "status"
            ? (Effect.succeed(actionResult) as Effect.Effect<A>)
            : status === "failure"
              ? Effect.fail(
                  new PreviewAutomationNoAvailableHostError({
                    operation: "status",
                    environmentId: scope.environmentId,
                    threadId: scope.thread.threadId,
                    providerSessionId: scope.thread.providerSessionId,
                    providerInstanceId: scope.thread.providerInstanceId,
                  }),
                )
              : (Effect.succeed(status) as Effect.Effect<A>),
      }),
    ),
  );

describe("action results", () => {
  it.effect("report the page state, a pending dialog, and tabs the action opened", () =>
    Effect.gen(function* () {
      const openedTabs = [{ tabId: "tab-2", url: "https://example.com/popup" }];
      const result = yield* runAction(
        "click",
        { openedTabs },
        {
          ...baseStatus,
          dialog: { type: "confirm", message: "Delete it?", defaultValue: "" },
          fileChooser: null,
        },
      );
      expect(result).toEqual({
        openedTabs,
        page: {
          url: "https://example.com/form",
          title: "Form",
          loading: false,
          dialog: { type: "confirm", message: "Delete it?", defaultValue: "" },
        },
        toolIcon: { _tag: "website", pageUrl: "https://example.com/form" },
      });
    }),
  );

  it.effect("keep the page small and omit a dialog and file chooser that are not open", () =>
    Effect.gen(function* () {
      const result = yield* runAction("press", undefined, {
        ...baseStatus,
        url: `https://example.com/${"a".repeat(5_000)}`,
        title: "t".repeat(5_000),
        loading: true,
        dialog: null,
        fileChooser: { multiple: true, accept: ".csv" },
      });
      expect(result).toMatchObject({
        page: { loading: true, fileChooser: { multiple: true, accept: ".csv" } },
      });
      const page = (result as { page: Record<string, unknown> }).page;
      expect(page).not.toHaveProperty("dialog");
      expect(JSON.stringify(page).length).toBeLessThan(3_000);
    }),
  );

  it.effect("still succeed without a page when the status read fails", () =>
    Effect.gen(function* () {
      const result = yield* runAction("click", undefined, "failure");
      expect(result).toEqual({});
    }),
  );
});

describe("claimPreviewRecording", () => {
  it.effect("overlapping and repeated claims return the same retained recording", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const uploadedAttachmentId = createPendingAttachmentId(".webm");
      const pendingPath = path.join(config.attachmentsDir, `${uploadedAttachmentId}.webm`);
      yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
      yield* fileSystem.writeFileString(pendingPath, "video!");
      const response = {
        id: "desktop-recording",
        tabId: "tab-1",
        path: "/desktop/recording.webm",
        mimeType: "video/webm",
        sizeBytes: 6,
        createdAt: "2026-09-07T00:00:00.000Z",
        uploadedAttachmentId,
      };
      const claim = claimPreviewRecording(ThreadId.make("thread-1"), response);
      const [first, second] = yield* Effect.all([claim, claim], { concurrency: "unbounded" });
      expect(first).toEqual(second);
      expect(yield* claim).toEqual(first);
      expect(yield* fileSystem.readFileString(first.path)).toBe("video!");
      expect(yield* fileSystem.exists(pendingPath)).toBe(false);
      const wrongThread = yield* claimPreviewRecording(ThreadId.make("thread-2"), response).pipe(
        Effect.result,
      );
      expect(wrongThread._tag).toBe("Failure");
      const wrongPath = yield* claimPreviewRecording(ThreadId.make("thread-1"), {
        ...response,
        uploadedAttachmentId: `../${uploadedAttachmentId}`,
      }).pipe(Effect.result);
      expect(wrongPath._tag).toBe("Failure");
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-preview-recording-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );

  it.effect.each([6, 5])(
    "claims only a complete uploaded recording (reported bytes: %s)",
    (sizeBytes) =>
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const uploadedAttachmentId = createPendingAttachmentId(".webm");
        const pendingPath = path.join(config.attachmentsDir, `${uploadedAttachmentId}.webm`);
        yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
        yield* fileSystem.writeFileString(pendingPath, "video!");
        const response = {
          id: "desktop-recording",
          tabId: "tab-1",
          path: "/desktop/recording.webm",
          mimeType: "video/webm",
          sizeBytes,
          createdAt: "2026-09-07T00:00:00.000Z",
          uploadedAttachmentId,
        };
        const result = yield* claimPreviewRecording(ThreadId.make("thread-1"), response).pipe(
          Effect.result,
        );
        if (sizeBytes === 6) {
          expect(result._tag).toBe("Success");
          if (result._tag !== "Success") return;
          expect(result.success.path).not.toBe(response.path);
          expect(parseThreadSegmentFromAttachmentId(result.success.id)).toBe("thread-1");
          expect(yield* fileSystem.readFileString(result.success.path)).toBe("video!");
          expect(yield* fileSystem.exists(pendingPath)).toBe(false);
        } else {
          expect(result._tag).toBe("Failure");
          if (result._tag !== "Failure") return;
          expect(result.failure._tag).toBe("PreviewAutomationRecordingTransferError");
          expect(yield* fileSystem.exists(pendingPath)).toBe(true);
        }
      }).pipe(
        Effect.provide(
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-preview-recording-" }).pipe(
            Layer.provideMerge(NodeServices.layer),
          ),
        ),
      ),
  );
});
