# Validation evidence

## Public landing and protected explorer

- Checked the three product cards and password flow in the in-app browser using temporary download manifests. Opened the protected listing and verified sign-out returned to the landing.
- The HTTP regression suite verifies public landing routes, rejection of unauthenticated listing and settings requests, login and sign-out, password replacement, public manifest bytes and ranged downloads.
- Production Nginx and Cloudflare were not changed or validated in this pass.

Validated locally on October 6, 2026. Production hosting was not changed.

## Source and compatibility

- Reviewed every original top-level file and `.claude/settings.local.json`. This checkout had no Git repository, dependency setup, server implementation, or local release directory.
- Backed up all nine original top-level files to `C:/Users/kevin/.codex/tmp/SHEFiles-before-20261006` before replacing the UI.
- Verified SHA-256 equality against the backup for `protected-rules.json`, `wiki-config.json`, `ereader-config.json`, and `ereader-manifest.json`. All four are unchanged.
- Kept `/downloads/`, original prefix/key semantics, direct file URLs, and `?open=` / `?download=` links. Legacy prefix folders are now hidden until unlocked.
- Removed the Wiki and Reader implementations, replacing their entry pages with explorer redirects. Kept their original JSON configuration as requested.

## Automated checks

`npm run check` passed for the explorer modules, password fallback, optional server, and worker. The original 17 model/server tests use temporary fixtures:

- Existing rules, wrapper metadata, per-folder overrides, and nested visibility.
- Encoded spaces, Unicode, percent characters, apostrophes, and rejected outside/traversal paths.
- Apache/nginx-style directory-link parsing and deduplication.
- Public hidden-folder downloads and unchanged raw manifest bytes.
- HEAD, byte ranges, ETags, and retired-entry redirects.
- Server-side authentication, CSRF/origin rejection, logout, and login rate limiting.
- Validated JSON writes (including UTF-8 BOM), exact backup bytes, unknown manifest fields, stale revisions, and concurrent-write conflicts.
- Configuration changes that would orphan visibility rules are rejected.
- HTTP SHA-256 fallback agrees with Node's SHA-256 for UTF-8 and multiple blocks.
- Folder-only, file-only, and combined prefix scopes, including legacy rules without a target.
- Exact file exceptions do not match similarly named sibling files; unknown metadata and existing keys survive.
- Own file prefixes remain effective inside individually public folders.
- Recent history is bounded, deduplicated, and validates encoded paths before rendering.
- The backend saves scoped/file rules without changing public manifest access.

## Interaction repair audit

After the reported navigation, scrolling and prefix-editor problems, added 13 DOM integration tests using the real HTML, application event handlers and temporary HTTP servers. `npm test` now passes 30 tests. jsdom is a development-only dependency; the deployed application still has no runtime dependencies.

Three new regression tests failed before the fixes: stale filters survived navigation, invalid imports replaced the current draft, and editor mutations stayed enabled during a file load. Additional tests cover Home/sidebar/mobile navigation, history, recent cards, search, sort, filters, list/grid, themes, refresh/retry, sharing, download requests, details, passwords, individual visibility, prefix add/scope/toggle/remove/save, JSON formatting/import/export, file selection, drafts, server conflicts, static mode, locking, and editing a public manifest.

Saving now blocks competing edits and dismissal until the result is known. A delayed import cannot overwrite a subsequently opened editor. Navigation resets filters and scroll position. The settings dialog has one scrolling body with a fixed action footer; its prefix list no longer scrolls independently, and the background page is locked while a dialog is open. Home spacing and recent lists are more compact. Versioned asset URLs request the updated UI on static hosts.

The old local preview process was no longer running. It was restarted with temporary fixtures. The browser tool rejected the existing error tab due to its `data:` URL, so **this repair has not had a new browser/layout acceptance pass**. DOM tests do not verify hit testing, pixel geometry, native dialog focus, actual clipboard permissions or downloaded files. The screenshots and browser evidence below describe the previous iteration, not this repair.

## Previous browser acceptance

Used the Codex in-app browser against isolated temporary releases, not production:

- Verified the light desktop UI and dark mobile UI, including no horizontal overflow at 390 px.
- Verified search, list/grid switching, public download, and copied `?download=` link.
- Verified the existing Meridian key reveals Meridian folders while SHE folders remain hidden.
- Verified an incorrect master key is rejected.
- Verified the requested master key opens the JSON editor.
- Verified invalid JSON is rejected and a valid rule save reports a private backup.
- Verified `?open=` enters a hidden folder without asking for a password.
- Verified static mode clearly offers JSON export rather than server saving; an exported rules file was present in Downloads with the expected JSON.
- Verified editor draft retention when switching between rules and explorer configuration.
- Verified locking static mode reloads published rules and discards the local export preview.
- Reviewed visible keyboard focus and responsive reflow. Native dialogs provide focus trapping and Escape dismissal.

The home/scopes refinement additionally verified:

- Home shows recent folders and downloaded files; the root and nested folders omit the banner.
- Standard desktop rows measure 64 px; the 1280 px desktop grid shows four columns with all eight visible fixture items in two rows.
- Sidebar expansion loads child folders without navigating, and selecting a nested folder highlights it and its ancestors.
- Switching SHE to folders-only leaves `SHE.Updater.json` visible; switching Meridian to files-only leaves its folder visible and hides its package.
- Adding Draft as a files-only prefix hides its text file while its folder stays visible; removing that prefix preserves an independently hidden README rule.
- A folder key reveals matching hidden files, while unrelated hidden files remain hidden.
- A shared hidden-file link reveals/downloads the selected file, without exposing a hidden sibling. Returning Home filters the hidden item from recents.
- An individual non-JSON file can be hidden through its details, without changing the file's bytes.
- The new prefix editor exports scoped rules in static mode and blocking reloads published rules.
- Home and root navigation work at 390 px without horizontal overflow. Mobile retains 44 px controls.

Previous screenshots: `test-results/compact-root-light.jpg`, `test-results/home-recents.jpg`, and `test-results/compact-mobile.jpg`. Earlier screenshots remain as evidence of the first iteration. All contain synthetic fixture files; none validates the latest repair.

## Limits

The real hosted release directory and production web-server configuration were not available in this workspace. Production updater clients, reverse-proxy setup, installed reader/PWA migration, browser zoom, and screen-reader output were not exercised against the real host. Static deployment must preserve its current directory listing and MIME settings. Saving from the browser to the host requires the optional Node adapter; static hosting uses explicit JSON export/replacement.
