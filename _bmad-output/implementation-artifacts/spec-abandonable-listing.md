---
title: 'Abandonable channel requests'
type: 'feature'
created: '2026-11-09'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A channel has one worker thread, and a `listFolder` blocked inside an OS call (`scandir` or `FindFirstFileW` on a dead network share, a drive that isn't ready) never reaches its next cancel check. Every newer listing queues behind it until the OS gives up, often 20 s or more, so latest-wins (AD-10) fails exactly when the user clicks away from a stuck folder. Split from Story 1.5 at the user's choice; recorded in `deferred-work.md` (Story 1.4 review D1 and the 1.5 scope split).

**Approach:** When a newer request cancels a running one and that one hasn't ended within a short grace period, the channel abandons it. It sends the abandoned request's `cancelled` reply at once, starts a fresh worker for the queue, and drops whatever the stuck thread produces when the OS call finally returns. A cap on stuck threads keeps a string of dead shares from piling up threads. Engine only: no protocol, UI or Rust change.

</frozen-after-approval>

## Implementation Notes

- `engine/adapters/stdio_transport.py` `Channel` is the only production change, so the `locations` channel (a blocking `GetVolumeInformationW`) gets the same protection as `listFolder`.
- Choices the user won't notice: a 250 ms grace period (a listing that is only slow checks its token every 200 entries and ends well within it), and at most 8 abandoned threads still alive per channel. At the cap the channel stops abandoning and the queue waits as before, with a warning in the log. Abandoned threads are daemon threads, so they never hold up engine exit.
- Every request still ends with exactly one terminal reply: whichever of "abandon" and "the handler returned" happens first, under the channel lock, sends it.
- The watch timer is keyed on the cancelled request's token, not on the job running at submit time: the worker can take a job off the queue a moment before it marks it running, and a job-keyed watch would miss one that then blocks.
- Files: `engine/adapters/stdio_transport.py` (`Channel`, `_Job`), `engine/tests/test_channel.py` (abandon, late reply dropped, grace period, cap, close), `engine/tests/test_stdio_roundtrip.py` (a `HANG` folder in the test file system; the next listing arrives within 2 s and the log shows the abandon).
- Surprise: `app/package.json` gained a whitespace-only line during this build that this work didn't write, probably from a concurrent session in the same tree. It was left as is and kept out of the commit.
- Verified: `uv run pytest` 177 passed. The timing-sensitive tests passed on 9 repeated runs.

## Review Triage Log

- `medium` patched — `close()` waited the full timeout for a stuck latest request and sent it no reply; and a watch firing during close could start a worker that took the sentinel while close joined the stuck thread. `close` now loops: it joins the current worker in grace-period steps, abandons a stuck running request (sending its `cancelled`), and follows any fresh worker. New test.
- `low` patched — every submit after the first started a timer thread, even when the previous request had already ended (200 quick submits, 202 threads). Watches now start only when the previous token isn't the last one that ended. New test.
- `low` patched — docstrings still said "one request at a time"; they now say an abandoned handler can run beside the next one, so handlers and ports must be thread-safe (as they already were across channels).
- `low` patched — the end-to-end test could pass with h1 cancelled while still queued; it now also asserts "abandoned a listFolder" in `engine.log`.
- `low` patched — the grace-period test released at once and passed trivially; it now keeps the handler running 0.5 s of a 2 s grace with nothing sent, inside `try/finally`.
- `low` patched — replacement workers shared the stuck thread's name; they are now `channel-{name}-{n}`.
- `low` rejected — at the cap, a stuck request is never re-checked when a slot frees up: needs 8 requests stuck at once on one channel, and fixing it adds a re-arm path.
- `false` — a lone stuck request with no successor, or a future `cancel` request, never abandons: with no queue behind it there is nothing to unblock, and no `cancel` request exists yet.
- `low` rejected — a 250 ms grace can abandon a listing that is only slow on a slow share: it still stops at its next token check (every 200 entries), so the cost is a few hundred ms of parallel reads.
- `low` rejected — the abandoned count isn't reported in `status`: nothing consumes it yet; the log records every abandon.
- `false` — the `app/package.json` whitespace change isn't part of this work (see Implementation Notes).
