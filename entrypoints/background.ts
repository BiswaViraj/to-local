import {
  CONTENT_SCRIPT_FILE,
  CONTENT_SCRIPT_ID,
  type OriginState,
  type RuntimeRequest,
  type RuntimeResponse
} from "../src/runtime/contracts";
import {
  normalizeOrigin,
  originToMatchPattern,
  uniqueMatchPatterns
} from "../src/runtime/origins";
import {
  getEnabledOrigins,
  setEnabledOrigins
} from "../src/runtime/storage";

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void reconcileRuntimeState();
  });

  browser.runtime.onStartup.addListener(() => {
    void reconcileRuntimeState();
  });

  browser.permissions.onAdded.addListener(() => {
    void reconcileRuntimeState();
  });

  browser.permissions.onRemoved.addListener(() => {
    void reconcileRuntimeState();
  });

  browser.runtime.onMessage.addListener(
    (
      request: RuntimeRequest,
      _sender,
      sendResponse: (response: RuntimeResponse) => void
    ) => {
      void handleRequest(request).then(sendResponse);
      return true;
    }
  );

  void reconcileRuntimeState();
});

async function handleRequest(
  request: RuntimeRequest
): Promise<RuntimeResponse> {
  try {
    if (request.type === "runtime:reconcile") {
      await reconcileRuntimeState();
      return { ok: true, message: "Runtime state reconciled." };
    }

    const origin = normalizeOrigin(request.origin);
    if (!origin) {
      return { ok: false, message: "Unsupported origin." };
    }

    if (request.type === "origin:get") {
      return {
        ok: true,
        message: "Origin state loaded.",
        state: await getOriginState(origin)
      };
    }

    const enabledOrigins = await getEnabledOrigins();
    const nextOrigins = request.enabled
      ? [...new Set([...enabledOrigins, origin])].sort()
      : enabledOrigins.filter((value) => value !== origin);

    await setEnabledOrigins(nextOrigins);

    if (!request.enabled) {
      await removeUnusedPermission(origin, nextOrigins);
    }

    await reconcileRuntimeState();

    return {
      ok: true,
      message: request.enabled
        ? "Origin enabled. Reload open pages to exercise persistent injection."
        : "Origin disabled."
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unexpected error."
    };
  }
}

async function getOriginState(origin: string): Promise<OriginState> {
  const enabledOrigins = await getEnabledOrigins();
  const pattern = originToMatchPattern(origin);
  const permissionGranted = await browser.permissions.contains({
    origins: [pattern]
  });
  const registrations = await browser.scripting.getRegisteredContentScripts({
    ids: [CONTENT_SCRIPT_ID]
  });

  return {
    enabled: enabledOrigins.includes(origin) && permissionGranted,
    permissionGranted,
    registeredPatterns: registrations[0]?.matches ?? []
  };
}

async function reconcileRuntimeState(): Promise<void> {
  const storedOrigins = await getEnabledOrigins();
  const permissionChecks = await Promise.all(
    storedOrigins.map(async (origin) => ({
      origin,
      granted: await browser.permissions.contains({
        origins: [originToMatchPattern(origin)]
      })
    }))
  );
  const enabledOrigins = permissionChecks
    .filter(({ granted }) => granted)
    .map(({ origin }) => origin);

  if (enabledOrigins.length !== storedOrigins.length) {
    await setEnabledOrigins(enabledOrigins);
  }

  await reconcileRegistration(uniqueMatchPatterns(enabledOrigins));
}

async function reconcileRegistration(matches: string[]): Promise<void> {
  const current = await browser.scripting.getRegisteredContentScripts({
    ids: [CONTENT_SCRIPT_ID]
  });

  if (matches.length === 0) {
    if (current.length > 0) {
      await browser.scripting.unregisterContentScripts({
        ids: [CONTENT_SCRIPT_ID]
      });
    }
    return;
  }

  const registration: Browser.scripting.RegisteredContentScript = {
    id: CONTENT_SCRIPT_ID,
    js: [CONTENT_SCRIPT_FILE],
    matches,
    allFrames: true,
    matchOriginAsFallback: true,
    persistAcrossSessions: true,
    runAt: "document_idle",
    world: "ISOLATED"
  };

  if (current.length === 0) {
    await browser.scripting.registerContentScripts([registration]);
    return;
  }

  await browser.scripting.updateContentScripts([registration]);
}

async function removeUnusedPermission(
  disabledOrigin: string,
  remainingOrigins: string[]
): Promise<void> {
  const disabledPattern = originToMatchPattern(disabledOrigin);
  const stillNeeded = remainingOrigins.some(
    (origin) => originToMatchPattern(origin) === disabledPattern
  );

  if (!stillNeeded) {
    try {
      await browser.permissions.remove({
        origins: [disabledPattern]
      });
    } catch {
      // Required permissions in the E2E build cannot be removed. Registration
      // reconciliation must still proceed from the application origin state.
    }
  }
}
