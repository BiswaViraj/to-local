# toLocal

`toLocal` is a Chrome extension for developers who read timestamps in logs,
observability dashboards, analytics tools, admin panels, and web applications.

Point at a timestamp to preview it in your local timezone. The original page
content stays untouched, and all processing happens in the browser.

The planned Chrome Web Store title is **toLocal: Local Time for Web
Timestamps**.

## Status

Under active development.

## Principles

- Timestamps must include an explicit timezone.
- Site access is granted one origin at a time.
- Page text is inspected only near the pointer.
- Page content is never rewritten.
- No telemetry or network requests.

## Development

Node 22 and pnpm are required.

```sh
pnpm install
pnpm dev
```

Useful checks:

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
```

## Security

Please report vulnerabilities according to [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
