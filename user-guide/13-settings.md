# 13. Settings

Open **Settings** from the top bar. It's where you manage credentials, appearance, and the
local database. Here's what each part does.

## Provider credentials

To use the [Testing console](./09-testing.md) (and, optionally, the
[Assistant](./12-assistant.md) via an API key), you add **provider credentials** — API keys for
the model providers you want to drive runs with. Keys are **encrypted before they're saved** and
are never shown back to you. Per-model pricing is used to estimate run costs; a model with no
known price can't be run, which keeps cost accounting honest.

## Appearance (themes)

Switch the app's theme between:

- **Light** — the default, a near-white surface set.
- **Dark** — a warm charcoal surface set.
- **System** — follow your operating system's light/dark setting automatically.

You can change the theme here or from the theme control in the top bar.

## Features

The **Features** section lets you switch whole parts of the app on and off.

Today there is one switch: **Assistant**. Turning it off removes the Assistant, Sessions,
Agents & Crews, Projects and Audit items from the sidebar, hides the App-assistant panel and its
⌘J shortcut, and hides the "Ask the assistant" buttons on other pages. If you open a bookmarked
Assistant page while it's off, the page explains that it's turned off and offers a link straight
back to this switch.

Two things worth knowing:

- **The switch is app-wide, not per-browser.** It's stored with the rest of your data, so it
  survives restarts and applies to anyone using this instance.
- **Off really means off.** The server refuses Assistant requests too, so a tab you left open, or
  anything else pointed at the app, can't keep an Assistant session running or spend tokens.

Turning a feature off asks you to confirm first and lists exactly what will disappear. Nothing is
deleted — turning it back on restores everything, immediately.

## Assistant sign-in

Connect the [Assistant](./12-assistant.md) to Claude, using either your **Claude subscription**
(an in-app sign-in) or an **Anthropic API key**. This is also where you'll see a warning if a
sign-in is close to expiring.

## Storage & maintenance

All your data — servers, scans, saved credentials, skills, runs — lives in a **single local
database file** on your machine (in Docker, on the app's `/data` volume). Because it's one file,
your work persists across restarts as long as you keep it.

This section lets you keep that database tidy:

- **Prune** old scans (you can also set a limit on how many scans to keep per server).
- **Vacuum / checkpoint** to reclaim space and flush pending writes.
- **Prune Assistant** history — thread history and any temporary workspaces the Assistant
  created.

## A word on secrets

The credentials and tokens you save are encrypted with a key the app manages for you. If you're
running in Docker, keep the database and its key together on the same `/data` volume. Advanced
users can supply their own key; most people don't need to. **If both the key and its file are
lost, saved secrets can't be recovered** — so if you back up the database, back up its key too.
See [Troubleshooting](./14-troubleshooting.md) for more.

---

Next: [Troubleshooting & FAQ →](./14-troubleshooting.md)
