import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import selfsigned from "selfsigned";

const port = Number.parseInt(process.argv[2] ?? "", 10);
const secure = process.argv[3] === "https";

if (!Number.isInteger(port)) {
  throw new Error("Fixture server requires a numeric port.");
}

const handleRequest = (request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");

  if (request.url === "/frame") {
    response.end(page("Frame", timestampRow("frame-timestamp")));
    return;
  }

  if (request.url === "/huge") {
    const rows = Array.from(
      { length: 100_000 },
      (_, index) =>
        `<div class="row">line ${index}: 2026-06-15T08:42:11.123456789Z request complete</div>`
    ).join("");
    response.end(page("Huge fixture", rows));
    return;
  }

  response.end(
    page(
      `Fixture ${port}`,
      `
        ${timestampRow("top-timestamp")}
        <iframe title="same-origin" src="/frame"></iframe>
        <iframe title="cross-origin" src="http://localhost:${otherPort(port)}/frame"></iframe>
      `
    )
  );
};

const server = secure
  ? await createHttpsFixtureServer(handleRequest)
  : createServer(handleRequest);

server.listen(port, "127.0.0.1");

async function createHttpsFixtureServer(handler) {
  const certificate = await selfsigned.generate(
    [{ name: "commonName", value: "localhost" }],
    {
      days: 1,
      keySize: 2048
    }
  );
  return createSecureServer(
    {
      cert: certificate.cert,
      key: certificate.private
    },
    handler
  );
}

function timestampRow(id) {
  return `<p class="log-row">request started <code id="${id}">2026-06-15T08:42:11.123456789Z</code> completed</p>`;
}

function page(title, body) {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>
          :root { font-size: 3px !important; }
          * { box-sizing: border-box; color: rebeccapurple; font-family: serif !important; }
          body { margin: 40px; font-size: 48px; }
          .log-row, .row { color: #1b261f; font: 14px/1.5 monospace !important; }
          iframe { display: block; width: 720px; height: 160px; margin-top: 24px; }
        </style>
      </head>
      <body>${body}</body>
    </html>`;
}

function otherPort(currentPort) {
  return currentPort === 4173 ? 4174 : 4173;
}
