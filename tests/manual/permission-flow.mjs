import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const extensionPath = path.resolve(".output/chrome-mv3");
const fixture = spawn(
  process.execPath,
  ["tests/e2e/fixture-server.mjs", "4173"],
  {
    stdio: "ignore"
  }
);

try {
  await waitForFixture();
  await runDeniedProfile();
  await runAllowedProfile();
} finally {
  fixture.kill();
}

async function runDeniedProfile() {
  const profile = await launchProfile();
  try {
    await requestPermission(profile.context, profile.extensionId, "deny");
  } finally {
    await closeProfile(profile);
  }
}

async function runAllowedProfile() {
  const profile = await launchProfile();
  try {
    const target = await profile.context.newPage();
    await target.goto("http://localhost:4173");
    await requestPermission(profile.context, profile.extensionId, "allow");
    await target.reload();
    await target.locator("tolocal-overlay").waitFor({ state: "attached" });

    await profile.serviceWorker.evaluate(async () => {
      await chrome.permissions.remove({
        origins: ["http://localhost/*"]
      });
    });
    await waitForRevocation(profile.serviceWorker);
  } finally {
    await closeProfile(profile);
  }
}

async function launchProfile() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "tolocal-manual-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  const serviceWorker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));

  return {
    context,
    extensionId: new URL(serviceWorker.url()).host,
    serviceWorker,
    userDataDir
  };
}

async function closeProfile(profile) {
  await profile.context.close();
  await rm(profile.userDataDir, { recursive: true, force: true });
}

async function requestPermission(browserContext, extensionId, outcome) {
  const popup = await browserContext.newPage();
  await popup.goto(
    `chrome-extension://${extensionId}/popup.html?origin=${encodeURIComponent("http://localhost:4173")}`
  );
  await popup.locator("#toggle").click();
  await popup
    .locator("#status")
    .filter({
      hasNotText: "Requesting access..."
    })
    .waitFor({ timeout: 120_000 });

  const granted = await popup.evaluate(async () =>
    chrome.permissions.contains({
      origins: ["http://localhost/*"]
    })
  );
  if ((outcome === "allow" && !granted) || (outcome === "deny" && granted)) {
    throw new Error(`Expected the user to ${outcome} the permission prompt.`);
  }
  await popup.close();
}

async function waitForRevocation(worker) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const state = await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get("toLocal:enabledOrigins");
      return {
        origins: stored["toLocal:enabledOrigins"] ?? [],
        registrations: await chrome.scripting.getRegisteredContentScripts()
      };
    });
    if (state.origins.length === 0 && state.registrations.length === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("External permission removal did not reconcile in time.");
}

async function waitForFixture() {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://localhost:4173");
      if (response.ok) {
        return;
      }
    } catch {
      // The fixture is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Local fixture server did not start.");
}
