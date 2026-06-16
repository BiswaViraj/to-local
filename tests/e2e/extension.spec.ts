import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const extensionPath = path.resolve(".output/chrome-mv3");

test("reconciles full origins, permissions, frames, and runtime registration", async () => {
  const context = await launchExtension();

  try {
    const page = await context.newPage();
    await page.goto("http://localhost:4173");

    const extensionId = await getExtensionId(context);
    await setOrigin(context, extensionId, "http://localhost:4173", true);
    await page.reload();

    await expect(page.locator("tolocal-overlay")).toHaveCount(1);
    await expect(
      page
        .frameLocator('iframe[title="same-origin"]')
        .locator("tolocal-overlay")
    ).toHaveCount(1);
    await expect(
      page
        .frameLocator('iframe[title="cross-origin"]')
        .locator("tolocal-overlay")
    ).toHaveCount(0);

    await page.locator("#top-timestamp").hover();
    await expect
      .poll(() =>
        page.locator("tolocal-overlay").evaluate((host) => {
          const shadow = host.shadowRoot;
          return shadow?.querySelector(".card")?.textContent ?? "";
        })
      )
      .toContain("2026-06-15T08:42:11.123456789Z");

    const cardGeometry = await page
      .locator("tolocal-overlay")
      .evaluate((host) => {
        const card = host.shadowRoot?.querySelector(".card");
        if (!card) {
          return null;
        }
        const rect = card.getBoundingClientRect();
        return rect
          ? {
              width: rect.width,
              top: rect.top,
              left: rect.left,
              display: getComputedStyle(card).display
            }
          : null;
      });
    expect(cardGeometry?.display).toBe("block");
    expect(cardGeometry?.width).toBeGreaterThan(100);
    expect(cardGeometry?.left).toBeGreaterThanOrEqual(0);
    expect(cardGeometry?.top).toBeGreaterThanOrEqual(0);

    await setOrigin(context, extensionId, "http://localhost:4174", true);
    await page.reload();
    await expect(
      page
        .frameLocator('iframe[title="cross-origin"]')
        .locator("tolocal-overlay")
    ).toHaveCount(1);

    await setOrigin(context, extensionId, "http://localhost:4173", false);
    await page.reload();
    await expect(page.locator("tolocal-overlay")).toHaveCount(0);
    await expect(
      page
        .frameLocator('iframe[title="cross-origin"]')
        .locator("tolocal-overlay")
    ).toHaveCount(1);

    await setOrigin(context, extensionId, "http://localhost:4174", false);
    const serviceWorker = await getServiceWorker(context);
    const state = await serviceWorker.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          chrome: {
            permissions: {
              contains(details: { origins: string[] }): Promise<boolean>;
            };
            scripting: {
              getRegisteredContentScripts(): Promise<unknown[]>;
            };
          };
        }
      ).chrome;

      return {
        registered: await api.scripting.getRegisteredContentScripts(),
        granted: await api.permissions.contains({
          origins: ["http://localhost/*"]
        })
      };
    });
    expect(state.registered).toEqual([]);
    expect(state.granted).toBe(true);
  } finally {
    await context.close();
  }
});

test("enabling an origin injects into an already-open tab without a reload", async () => {
  const context = await launchExtension();

  try {
    const extensionId = await getExtensionId(context);
    const page = await context.newPage();
    await page.goto("http://localhost:4173");
    await expect(page.locator("tolocal-overlay")).toHaveCount(0);

    // Enable while the tab is already open; the overlay must appear with no
    // reload (Chrome's registration alone would only take effect on next load).
    await setOrigin(context, extensionId, "http://localhost:4173", true);
    await expect(page.locator("tolocal-overlay")).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test("renders above a max z-index drawer via the top layer", async () => {
  const context = await launchExtension();

  try {
    const extensionId = await getExtensionId(context);
    await setOrigin(context, extensionId, "http://localhost:4173", true);
    const page = await context.newPage();
    await page.goto("http://localhost:4173/argocd");

    // Simulate ArgoCD's sliding drawer: a max z-index layer mounted after the
    // content script, with the timestamp inside it.
    await page.evaluate(() => {
      const drawer = document.createElement("div");
      drawer.id = "drawer";
      drawer.style.cssText =
        "position:fixed;inset:0;background:#fff;z-index:2147483647;overflow:auto";
      document.body.appendChild(drawer);
      drawer.appendChild(document.getElementById("panel")!);
      document.getElementById("ts")!.scrollIntoView({ block: "center" });
    });

    await page.locator("#ts").hover();
    const host = page.locator("tolocal-overlay");
    await expect
      .poll(() =>
        host.evaluate((h) =>
          h.shadowRoot!.querySelector(".card")!.matches(":popover-open")
        )
      )
      .toBe(true);

    // The card is the topmost element at its own center, above the drawer.
    const onTop = await page.evaluate(() => {
      const h = document.querySelector("tolocal-overlay")!;
      const c = h.shadowRoot!.querySelector(".card")!.getBoundingClientRect();
      return (
        document.elementFromPoint(
          c.left + c.width / 2,
          c.top + c.height / 2
        ) === h
      );
    });
    expect(onTop).toBe(true);
  } finally {
    await context.close();
  }
});

test("disabling an origin tears down the overlay in an open tab", async () => {
  const context = await launchExtension();

  try {
    const extensionId = await getExtensionId(context);
    await setOrigin(context, extensionId, "http://localhost:4173", true);

    const page = await context.newPage();
    await page.goto("http://localhost:4173");
    await expect(page.locator("tolocal-overlay")).toHaveCount(1);

    // Disabling from the popup must deactivate the open tab with no reload.
    await setOrigin(context, extensionId, "http://localhost:4173", false);
    await expect(page.locator("tolocal-overlay")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("detects split timestamps, <time> elements, and the nearest match", async () => {
  const context = await launchExtension();

  try {
    const extensionId = await getExtensionId(context);
    await setOrigin(context, extensionId, "http://localhost:4173", true);
    const page = await context.newPage();
    await page.goto("http://localhost:4173/semantic");
    await expect(page.locator("tolocal-overlay")).toHaveCount(1);

    const cardText = () =>
      page.locator("tolocal-overlay").evaluate((host) => {
        const card = host.shadowRoot?.querySelector(".card");
        return getComputedStyle(card!).display === "none"
          ? ""
          : (card?.querySelector(".source-value")?.textContent ?? "");
      });

    // Rows are spaced far apart in the fixture so the card shown for one hover
    // never sits under the next teleported hover target.

    // Split across two spans, reconstructed into one value.
    await page.locator("#split-b").hover();
    await expect.poll(cardText).toBe("2026-06-15T08:42:11Z");

    // <time datetime> wins over the visible "2 hours ago" label.
    await page.locator("#time-el").hover();
    await expect.poll(cardText).toBe("2026-03-08T07:00:00Z");

    // Nearest of two timestamps on one line.
    await page.locator("#multi-second").hover();
    await expect.poll(cardText).toBe("2026-06-15T09:30:00Z");
  } finally {
    await context.close();
  }
});

test("converts the current selection into a pinned card", async () => {
  const context = await launchExtension();

  try {
    const extensionId = await getExtensionId(context);
    await setOrigin(context, extensionId, "http://localhost:4173", true);
    const page = await context.newPage();
    await page.goto("http://localhost:4173");
    await expect(page.locator("tolocal-overlay")).toHaveCount(1);

    await page.evaluate(() => {
      const node = document.getElementById("top-timestamp")!;
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });

    // Drive the same message the Ctrl/Cmd+Shift+L command dispatches.
    const worker = await getServiceWorker(context);
    await worker.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          chrome: {
            tabs: {
              query(q: object): Promise<Array<{ id?: number; url?: string }>>;
              sendMessage(id: number, message: unknown): Promise<void>;
            };
          };
        }
      ).chrome;
      const tabs = await api.tabs.query({});
      const tab = tabs.find((t) => t.url?.includes("localhost:4173"));
      if (tab?.id !== undefined) {
        await api.tabs.sendMessage(tab.id, { type: "convert-selection" });
      }
    });

    const host = page.locator("tolocal-overlay");
    await expect
      .poll(() =>
        host.evaluate(
          (h) => h.shadowRoot?.querySelector(".source-value")?.textContent ?? ""
        )
      )
      .toBe("2026-06-15T08:42:11.123456789Z");
    // The converted local time is shown and the card is pinned with actions.
    await expect(host.locator(".local")).not.toBeEmpty();
    await expect(host.locator(".copy").first()).toBeVisible();
  } finally {
    await context.close();
  }
});

test("persists registration across a browser restart", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "tolocal-e2e-"));
  let context = await launchExtension(userDataDir);

  try {
    const extensionId = await getExtensionId(context);
    await setOrigin(context, extensionId, "http://localhost:4173", true);
    await context.close();

    context = await launchExtension(userDataDir);
    const serviceWorker = await getServiceWorker(context);
    await expect
      .poll(async () =>
        serviceWorker.evaluate(async () => {
          const api = (
            globalThis as unknown as {
              chrome: {
                scripting: {
                  getRegisteredContentScripts(): Promise<
                    Array<{ id: string; persistAcrossSessions?: boolean }>
                  >;
                };
              };
            }
          ).chrome;
          return api.scripting.getRegisteredContentScripts();
        })
      )
      .toEqual([
        expect.objectContaining({
          id: "tolocal-runtime",
          persistAcrossSessions: true
        })
      ]);

    const page = await context.newPage();
    await page.goto("http://localhost:4173");
    await expect(page.locator("tolocal-overlay")).toHaveCount(1);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("does not scan or wrap a 100,000-line fixture", async () => {
  const context = await launchExtension();

  try {
    const extensionId = await getExtensionId(context);
    await setOrigin(context, extensionId, "http://localhost:4173", true);
    const page = await context.newPage();
    await page.goto("http://localhost:4173/huge");
    await expect(page.locator("tolocal-overlay")).toHaveCount(1);
    await expect(page.locator(".row")).toHaveCount(100_000);

    const result = await page.evaluate(async () => {
      const longTasks: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push(entry.duration);
        }
      });
      observer.observe({ type: "longtask", buffered: false });

      const start = performance.now();
      for (let index = 0; index < 1_000; index += 1) {
        document.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: 10 + (index % 20),
            clientY: 10 + (index % 20)
          })
        );
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      observer.disconnect();

      return {
        elapsed: performance.now() - start,
        longTasks,
        extensionHosts: document.querySelectorAll("tolocal-overlay").length,
        timestampWrappers: document.querySelectorAll("[data-tolocal-timestamp]")
          .length
      };
    });

    expect(result.extensionHosts).toBe(1);
    expect(result.timestampWrappers).toBe(0);
    expect(result.longTasks).toEqual([]);
    expect(result.elapsed).toBeLessThan(500);
  } finally {
    await context.close();
  }
});

for (const origin of [
  "http://localhost:4173",
  "http://tolocal.test:4173",
  "https://localhost:4175"
]) {
  test(`copies from the overlay without clipboard permission on ${origin}`, async () => {
    const context = await launchExtension();

    try {
      const extensionId = await getExtensionId(context);
      await setOrigin(context, extensionId, origin, true);
      const page = await context.newPage();
      await page.goto(origin);
      await page.locator("#top-timestamp").hover();

      const host = page.locator("tolocal-overlay");
      await expect(host).toHaveCount(1);
      // Copy actions appear once the card is pinned by clicking it.
      await host.locator(".card").click();
      await host.locator(".copy").first().click();
      await expect(host.locator(".status")).toContainText(/Copied/);
    } finally {
      await context.close();
    }
  });
}

test("options page persists preferences and manages origins", async () => {
  const context = await launchExtension();

  try {
    const extensionId = await getExtensionId(context);
    // Enable an origin through the working popup flow so the options page has a
    // site to list and remove.
    await setOrigin(context, extensionId, "http://localhost:4173", true);

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.getByRole("button", { name: "Fixed zone" }).click();
    await page.getByLabel("Search timezones").fill("Tokyo");
    await page.getByRole("button", { name: /Asia\/Tokyo/ }).click();

    // Preferences survive a reload.
    await page.reload();
    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(
      page.getByRole("button", { name: "Fixed zone" })
    ).toHaveAttribute("aria-pressed", "true");

    // Reject an invalid origin.
    await page.getByLabel("Add an origin").fill("not a url");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText(/full http\(s\) origin/)).toBeVisible();

    // The enabled origin is listed and can be removed.
    await expect(
      page.getByText("http://localhost:4173", { exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(
      page.getByText("http://localhost:4173", { exact: true })
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("onboarding converts samples and remembers completion", async () => {
  const context = await launchExtension();

  try {
    const extensionId = await getExtensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding.html`);

    await page.getByRole("button", { name: "2026-06-15T08:42:11Z" }).click();
    await expect(page.getByRole("button", { name: "Copy ISO" })).toBeVisible();

    await page.getByRole("button", { name: "Got it" }).click();

    const worker = await getServiceWorker(context);
    const completed = await worker.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          chrome: {
            storage: {
              local: { get(key: string): Promise<Record<string, unknown>> };
            };
          };
        }
      ).chrome;
      const stored = await api.storage.local.get("toLocal:state");
      const state = stored["toLocal:state"] as {
        onboarding?: { completed?: boolean };
      };
      return state?.onboarding?.completed;
    });
    expect(completed).toBe(true);
  } finally {
    await context.close();
  }
});

async function launchExtension(userDataDir = ""): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--host-resolver-rules=MAP tolocal.test 127.0.0.1"
    ]
  });
}

async function getServiceWorker(context: BrowserContext) {
  return (
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  );
}

async function getExtensionId(context: BrowserContext): Promise<string> {
  const worker = await getServiceWorker(context);
  return new URL(worker.url()).host;
}

async function setOrigin(
  context: BrowserContext,
  extensionId: string,
  origin: string,
  enabled: boolean
): Promise<void> {
  const popup = await context.newPage();
  await popup.goto(
    `chrome-extension://${extensionId}/popup.html?origin=${encodeURIComponent(origin)}`
  );

  const expectedLabel = enabled ? "Enable this origin" : "Disable this origin";
  await expect(popup.locator("#toggle")).toHaveText(expectedLabel);
  await popup.locator("#toggle").click();

  if (enabled) {
    await expect
      .poll(() => popup.locator("#status").textContent())
      .toMatch(/Host permission granted|Origin enabled/);
  } else {
    await expect(popup.locator("#toggle")).toHaveText("Enable this origin");
  }
  await popup.close();
}
