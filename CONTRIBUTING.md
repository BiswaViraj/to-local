# Contributing

Thanks for helping improve `toLocal`.

## Before Opening a Change

1. Search existing issues.
2. Keep proposals within the documented v1 boundaries.
3. For parser additions, include representative accepted and rejected inputs.
4. For page compatibility issues, include a minimal reproducible fixture when
   possible and remove private page data.

## Development Expectations

- Use Node 22 and pnpm.
- Keep page processing local and avoid network access.
- Do not add install-time broad host permissions.
- Do not use `Date.parse` as a format parser.
- Do not introduce React into the content-script bundle.
- Add focused tests for behavior changes.

Commands and repository conventions will be expanded with the engineering
foundation.

## Pull Requests

Describe the user-visible behavior, risks, and verification performed. Small,
focused changes are preferred.

