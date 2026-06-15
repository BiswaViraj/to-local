import "./style.css";
import {
  getActiveTabOrigin,
  getOriginState,
  setOriginEnabled
} from "../../src/runtime/client";
import { normalizeOrigin } from "../../src/runtime/origins";

const originElement = requireElement<HTMLParagraphElement>("#origin");
const toggleButton = requireElement<HTMLButtonElement>("#toggle");
const statusElement = requireElement<HTMLParagraphElement>("#status");

let activeOrigin: string | null = null;
let enabled = false;

async function render(): Promise<void> {
  const requestedOrigin = new URL(location.href).searchParams.get("origin");
  activeOrigin = requestedOrigin
    ? normalizeOrigin(requestedOrigin)
    : await getActiveTabOrigin();

  if (!activeOrigin) {
    originElement.textContent = "This page does not expose an HTTP(S) origin.";
    toggleButton.disabled = true;
    return;
  }

  const state = await getOriginState(activeOrigin);
  enabled = state.enabled;
  originElement.textContent = activeOrigin;
  toggleButton.textContent = enabled
    ? "Disable this origin"
    : "Enable this origin";
  toggleButton.disabled = false;
  statusElement.textContent = state.permissionGranted
    ? "Host permission granted."
    : "Host permission not granted.";
}

toggleButton.addEventListener("click", async () => {
  if (!activeOrigin) {
    return;
  }

  toggleButton.disabled = true;
  statusElement.textContent = enabled
    ? "Removing access..."
    : "Requesting access...";

  const result = await setOriginEnabled(activeOrigin, !enabled);
  statusElement.textContent = result.message;
  await render();
});

void render();

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Popup is missing ${selector}.`);
  }
  return element;
}
