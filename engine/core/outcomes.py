"""ReadOutcome: why a file's content wasn't read, shared by preview and (later) indexing.

Adapters report raw facts (an attribute, an exception); the core maps them to one of these, and
the protocol sends the value as a code the UI words. Per-file failures are ReadOutcomes, never
protocol errors.
"""

from __future__ import annotations

from enum import StrEnum


class ReadOutcome(StrEnum):
    STORED_ONLY_IN_ONEDRIVE = "storedOnlyInOneDrive"
    """Online only (a cloud placeholder): its content isn't on this PC, and it is never opened."""
    PASSWORD_PROTECTED = "passwordProtected"
    NO_TEXT_LAYER = "noTextLayer"
    TOO_LARGE = "tooLarge"
    """Over the size cap the reading rules set (`core/rules/`)."""
    CANNOT_READ = "cannotRead"
    """Missing, access denied, in use, or not read before the deadline."""
    UNSUPPORTED_TYPE = "unsupportedType"


# The outcomes a preview can end with (protocol/codes.json readOutcomeCodes).
PREVIEW_OUTCOMES = (ReadOutcome.STORED_ONLY_IN_ONEDRIVE, ReadOutcome.TOO_LARGE, ReadOutcome.CANNOT_READ)
