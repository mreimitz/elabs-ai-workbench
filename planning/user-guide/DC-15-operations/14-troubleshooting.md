---
type: "Guide Page"
title: "14. Troubleshooting & FAQ"
description: "Common questions and fixes, grouped by where you'll run into them."
tags: ["documentation", "DC-15"]
timestamp: "2026-08-20T13:47:37Z"
status: "current"
---
# 14. Troubleshooting & FAQ

Common questions and fixes, grouped by where you'll run into them.

## Connecting to a server

**The connection test fails.**
Check, in order: the **command and arguments** (for a local/stdio server) or the **URL** (for an
HTTP server); whether the server actually needs **credentials** you haven't provided; and the
error message the app shows — it usually names the cause. Fix the field and test again.

**My HTTP server needs a login I don't see how to provide.**
When you enter a URL, the app probes it and then offers the right **authentication method**
(bearer token, API key header, or OAuth). If it doesn't prompt for auth but the server needs it,
double-check the URL points at the MCP endpoint.

**I'm running the app in Docker and it can't reach my other server.**
The app resolves URLs from *inside its container*, so `localhost` there isn't your Mac. If your
MCP server publishes a port to your Mac, use `host.docker.internal` instead — for example
`http://host.docker.internal:7030/mcp`. A bare service name from a different Docker project
won't resolve unless both containers share a network.

**OAuth won't complete.**
Some providers require a **pre-registered OAuth client**. In the provider's admin UI, create an OAuth
client with the scopes `user_default` and `mcp:execute`, add the app's callback URL
(`http://127.0.0.1:8080/api/oauth/callback` by default) as an allowed redirect, and enter the
resulting **Client ID** in the wizard. Leave the Client Secret empty for Native or Single-page
clients; enter it only for Web clients.

## Scanning and comparing

**The footprint numbers look different from what I expected.**
Make sure you're using the [token profile](../DC-01-getting-started/01-key-concepts.md) that matches your target model.
The two real-tokenizer profiles (`generic_o200k`, `generic_cl100k`) are the accurate ones; the
estimate profiles are approximations.

**The app won't let me compare two scans / warns about profiles.**
The two scans were counted with **different token profiles**, and comparing their numbers would
be misleading. Re-scan one side with the matching profile, then compare.

## Testing

**A run is rejected because of pricing.**
The Testing console won't run a model whose price it doesn't know, so cost estimates stay
truthful. Use a model that has pricing, or check your provider settings.

**Testing does nothing / asks for a provider.**
A run needs a **provider credential** (a model API key). Add one in
[Settings](../DC-14-settings-and-features/13-settings.md) first.

## Assistant

**The Assistant is asking me to sign in.**
Connect it in [Settings](../DC-14-settings-and-features/13-settings.md) using your Claude subscription or an Anthropic API
key. If you hit a usage limit, the app offers an explicit action to retry on the other method.

## Data & storage

**Where is my data? Will I lose it?**
Everything lives in a **single local database file** (on the `/data` volume in Docker). Keep
that file and your work persists across restarts.

**I backed up the database but my saved secrets don't work on restore.**
Saved credentials are encrypted with a key the app manages alongside the database. Back up the
**key together with the database** — if both the key and its file are lost, saved secrets can't
be recovered. (You'll re-enter credentials in that case; nothing else is lost.)

**The database is getting large.**
Use **Settings → Storage & maintenance** to prune old scans, vacuum the database, and prune
Assistant history. You can also set a per-server scan-retention limit.

## Still stuck?

The app surfaces errors rather than hiding them — read the message in the toast or panel, which
usually points at the cause. For anything about *what's built vs. planned*, the project's own
`CLAUDE.md` and status ledgers are the source of truth.

---

Next: [Assistant →](../DC-13-assistant-hub/16-assistant-hub.md)
