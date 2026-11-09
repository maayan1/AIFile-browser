"""Cancel tokens for latest-wins channels (AD-10): long work checks its token and stops."""

from __future__ import annotations

import threading


class Cancelled(Exception):
    """Raised by work whose request a newer one replaced."""


class CancelToken:
    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def raise_if_cancelled(self) -> None:
        if self._event.is_set():
            raise Cancelled
