import type { OriginState, RuntimeRequest, RuntimeResponse } from "./contracts";
import { normalizeOrigin, originToMatchPattern } from "./origins";

export async function getActiveTabOrigin(): Promise<string | null> {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab?.url ? normalizeOrigin(tab.url) : null;
}

export async function getOriginState(origin: string): Promise<OriginState> {
  const response = await sendRuntimeRequest({
    type: "origin:get",
    origin
  });

  if (!response.ok || !response.state) {
    throw new Error(response.message);
  }

  return response.state;
}

export async function setOriginEnabled(
  origin: string,
  enabled: boolean
): Promise<RuntimeResponse> {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return { ok: false, message: "Unsupported origin." };
  }

  if (enabled) {
    const granted = await browser.permissions.request({
      origins: [originToMatchPattern(normalizedOrigin)]
    });
    if (!granted) {
      return { ok: false, message: "Permission request was denied." };
    }
  }

  return sendRuntimeRequest({
    type: "origin:set",
    origin: normalizedOrigin,
    enabled
  });
}

async function sendRuntimeRequest(
  request: RuntimeRequest
): Promise<RuntimeResponse> {
  return browser.runtime.sendMessage(request) as Promise<RuntimeResponse>;
}
