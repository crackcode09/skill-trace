# Global Skills Log
<!-- skill-trace-schema: 1 -->

> DEMO DATA — fictional lessons for showcasing the dashboard. Not real entries.
> Launch: GLOBAL_SKILLS_MD_PATH=demo/skills-demo.md GLOBAL_SKILLS_PORT=38890 node viewer/server.js

## [2026-06-12] — Lock the file every writer touches, not just the obvious one <!-- sync-service -->

**Stack:** node, concurrency, locking

**Problem:** Two sessions appended to the same log file at once and produced a duplicate.

**Solution:** Put the read-modify-write behind the same advisory lock the sibling file already used.

**Takeaway:** If two writers touch a file, they need the same lock — the one you skip is the one that bites.

## [2026-06-11] — A PowerShell hashtable arg eats the next operator's comma <!-- deploy-scripts -->

**Stack:** powershell

**Problem:** A `@{}` literal passed as a method argument swallowed `-replace`'s comma, killing the call silently.

**Solution:** Wrap the operator expression in parentheses so the comma binds where intended.

**Takeaway:** In PowerShell, parenthesize an operator expression before passing it as an argument.

## [2026-06-10] — Strip the UTF-8 BOM before parsing <!-- sync-service -->

**Stack:** encoding, parsing, node

**Problem:** A file saved with a BOM prefixed the first header, so the parser matched zero records.

**Solution:** Strip a leading BOM on read; reading as plain UTF-8 does not remove it.

**Takeaway:** Always strip a leading BOM before line-anchored parsing — utf-8-sig or an explicit replace.

## [2026-06-09] — CORS `*` is dangerous even on a localhost-only service <!-- inventory-portal -->

**Stack:** security, http

**Problem:** A wildcard CORS header on a dev server let any visited page call its API.

**Solution:** Echo an explicit localhost origin and require POST for state-changing routes.

**Takeaway:** Never ship `Access-Control-Allow-Origin: *` on anything that holds local state.

## [2026-06-08] — Verify a package is actually installed before importing <!-- build-tools -->

**Stack:** node

**Problem:** Code imported a dependency that was only assumed present; it crashed on a clean machine.

**Solution:** Add a guarded require with a clear error, and pin the dep in the manifest.

**Takeaway:** Don't assume the environment — check the dependency exists and fail loudly if not.

## [2026-06-07] — Debounce the file watcher or you resync on every keystroke <!-- sync-service -->

**Stack:** node, performance

**Problem:** An `fs.watch` handler fired several times per save, rebuilding the index redundantly.

**Solution:** Debounce the watcher with a 500ms trailing timer before re-reading.

**Takeaway:** Coalesce burst filesystem events with a short debounce before doing expensive work.

## [2026-06-06] — Tabular numbers stop counts from jittering <!-- qa-dashboard -->

**Stack:** css

**Problem:** Right-aligned counts shifted horizontally as digits changed because the font was proportional.

**Solution:** Apply `font-variant-numeric: tabular-nums` to the count elements.

**Takeaway:** Use tabular-nums for any number that updates in place, so its width stays stable.

## [2026-06-05] — A named SQL Server instance needs host\instance, not a port guess <!-- inventory-portal -->

**Stack:** sql-server

**Problem:** Connections to a named instance timed out when only a hostname was supplied.

**Solution:** Use the `host\instance` form (or resolve the dynamic port via the SQL Browser service).

**Takeaway:** Named SQL Server instances resolve by `host\instance`, not by a default port.

## [2026-06-04] — Rebase stale branches before adding commits <!-- deploy-scripts -->

**Stack:** git

**Problem:** Commits pushed to a branch after its PR merged were silently orphaned.

**Solution:** Check the PR state and branch fresh from the base before continuing work.

**Takeaway:** Before pushing to an existing branch, confirm its PR hasn't already merged.

## [2026-06-03] — Fail open, not closed, when a lock can't be acquired <!-- sync-service -->

**Stack:** concurrency, node

**Problem:** A hook that errored when it couldn't grab a lock dropped the user's data on the floor.

**Solution:** On lock-acquire failure, skip this pass and let the next event retry — the source data persists.

**Takeaway:** For best-effort background work, fail open and retry; never lose user data on contention.

## [2026-06-02] — Pin CDN scripts with subresource integrity <!-- inventory-portal -->

**Stack:** security, html

**Problem:** Third-party CDN scripts loaded without integrity checks could be swapped upstream.

**Solution:** Add `integrity` + `crossorigin` attributes computed from the pinned file.

**Takeaway:** Always pin external scripts with an SRI hash so a compromised CDN can't inject code.
