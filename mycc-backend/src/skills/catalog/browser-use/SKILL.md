---
name: browser-use
description: Use whenever the user asks to open, inspect, browse, log in to, test, or interact with any website, URL, link, web app, browser page, or GUI browser inside the MyCC assistant sandbox. This skill should trigger even when the user only pastes a link or says to check a site.
---

# Browser Use In MyCC Sandbox

The sandbox includes Python, Playwright, browser-use, and Chromium. MyCC mirrors the GNU desktop through the right-side browser workbench, so browser tasks that should be visible to the user must run on the desktop display.

Prefer these defaults:

- Workspace: `/home/mycc/workspace`
- Browser agent venv: `/opt/mycc/browser-agent/venv`
- Desktop display: `${MYCC_DESKTOP_DISPLAY:-:99}`
- Visible browser CDP: `http://127.0.0.1:${MYCC_DESKTOP_BROWSER_CDP_PORT:-9222}`
- Default visible browser CDP URL: `http://127.0.0.1:9222`
- Chromium executable: `chromium`

## Required Flow

1. For a user-visible website, URL, login, browser preview, or page inspection task, resolve the target as the model. Use a concrete URL whenever the user names a site. For example, `baidu` or `百度` means `https://www.baidu.com/`; do not pass raw search words such as `baidu` when you can resolve the homepage URL.
2. Keep browser automation on the desktop display:
   `export DISPLAY="${MYCC_DESKTOP_DISPLAY:-:99}"`
3. If the display is not ready, start the desktop service with `MYCC_DESKTOP_OPEN_BROWSER=0 nohup mycc-start-desktop >/tmp/mycc-desktop/desktop-from-agent.log 2>&1 &`, then wait until `xdpyinfo -display "${MYCC_DESKTOP_DISPLAY:-:99}"` succeeds.
4. Open the visible browser through XFCE's configured Web Browser helper, for example:
   `DISPLAY="${MYCC_DESKTOP_DISPLAY:-:99}" MYCC_DESKTOP_BROWSER_WINDOW_SIZE="${MYCC_DESKTOP_BROWSER_WINDOW_SIZE:-1440,900}" exo-open --launch WebBrowser "https://www.baidu.com/"`
5. Treat the visible CC computer browser as the default automation target. Do not launch a hidden Chrome for Testing, headless Chromium, or a separate Playwright browser unless the user explicitly asks for an isolated test browser or the visible browser cannot be recovered.
6. For deterministic actions, connect Playwright to the visible browser over CDP from `/opt/mycc/browser-agent/venv`:
   `cdp_url="http://127.0.0.1:${MYCC_DESKTOP_BROWSER_CDP_PORT:-9222}"`
7. Use browser-use when the task benefits from LLM-guided browser navigation, and configure it to connect to the same visible browser via `--cdp-url "$cdp_url"` or its equivalent CDP session option. Prefer the visible browser over browser-use's default auto-launched browser.
8. Do not print access tokens, cookies, provider base URLs, E2B hosts, or private credentials.

The MyCC web UI should not need the raw URL to wake the browser. It only mirrors the GNU desktop when it sees real browser-related tool use from the agent.
