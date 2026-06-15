import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

const isE2eBuild = process.env.TOLOCAL_E2E === "1";

export default defineConfig({
  // React powers the popup, options, and onboarding pages only. The content
  // script stays framework-free and is guarded by scripts/check-bundle.mjs.
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()]
  }),
  manifest: {
    name: "toLocal: Local Time for Web Timestamps",
    description:
      "Preview explicit-zone web timestamps in local time without rewriting the page.",
    minimum_chrome_version: "119",
    permissions: ["activeTab", "commands", "scripting", "storage"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
    host_permissions: isE2eBuild
      ? ["http://localhost/*", "http://tolocal.test/*", "https://localhost/*"]
      : undefined,
    commands: {
      "convert-selection": {
        suggested_key: {
          default: "Ctrl+Shift+L",
          mac: "Command+Shift+L"
        },
        description: "Convert the selected explicit-zone timestamp"
      }
    }
  }
});
