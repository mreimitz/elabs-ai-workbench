# API notes

The upstream tracker's REST API returns rate-limit state in two response headers:

- `X-RateLimit-Remaining` — requests left in the current window.
- `X-RateLimit-Reset` — unix timestamp when the window resets.

Back off until that timestamp before retrying a failed fetch.
