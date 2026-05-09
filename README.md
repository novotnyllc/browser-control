<p align="center">
  <img src="plugins/browser-control/assets/logo.png" alt="Browser Control logo" width="120">
</p>

<h1 align="center">Browser Control</h1>

<p align="center">
  Helping Codex's new Chrome plugin work across the browsers and channels people actually use.
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.2-blue">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
  <img alt="Codex plugin" src="https://img.shields.io/badge/Codex-plugin-black">
</p>

## Why This Exists

Codex's new Chrome plugin currently only supports Chrome Stable. Browser Control fills in the gap for Edge and for the Beta, Dev, and Canary channels.

## What It Adds

Browser Control teaches Codex about the browser channels that matter:

| Browser family | Supported channels |
|---|---|
| Google Chrome | Stable, Beta, Dev, Canary |
| Microsoft Edge | Stable, Beta, Dev, Canary |

You can invoke it directly:

```text
@browser-control open the dashboard I was just using
```

You do not have to name a channel every time. If you do not specify one, Browser Control is instructed to infer the best available browser from your context, connected browser, frontmost browser, and recent browser activity.

When it matters, you can name the browser, channel, or profile:

```text
use my work profile to check the staging login
open the billing portal in Edge Dev
use Chrome Dev to test this localhost page
check the Microsoft admin center in my Edge work profile
open the beta site in Chrome Canary
use my personal Chrome profile for this checkout flow
```

The goal is simple: when you ask Codex to use a browser, it should use the right one.

## Install

```sh
codex plugin marketplace add novotnyllc/browser-control
```

Then enable it in Codex config if needed:

```toml
[plugins."browser-control@browser-control"]
enabled = true
```

Restart Codex after changing plugin config.

## Update

```sh
codex plugin marketplace upgrade browser-control
```

## License

MIT. See [LICENSE](LICENSE).
