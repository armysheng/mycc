---
name: browser-use
description: Use when an agent needs to operate a real browser inside the MyCC assistant sandbox.
---

# Browser Use In MyCC Sandbox

The sandbox includes Python, Playwright, browser-use, and a Chromium binary that can run headless or on the GNU desktop display.

Prefer these defaults:

- Workspace: `/home/mycc/workspace`
- Browser agent venv: `/opt/mycc/browser-agent/venv`
- Desktop display: `${MYCC_DESKTOP_DISPLAY:-:99}`
- Chromium executable: `chromium`

For deterministic automation, use Playwright first. Use browser-use when the task benefits from LLM-guided browser navigation.
