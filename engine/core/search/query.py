"""parse_query(): the one place a search's text is read (AD-15).

Its normalization is the one name matching uses, and later date and filler matching will share it.
In this epic the mode is always `normal` and there is no date phrase: the residual text is the
whole text, trimmed. Hebrew prefixes and filler words are not normalized here (not this epic).
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import Any

NORMAL = "normal"


@dataclass(frozen=True)
class Query:
    """A parsed search: what `searchParsed` reports, and what the name search matches."""

    mode: str
    date_range: dict[str, Any] | None
    residual_text: str
    """The text left to match against names: trimmed, as typed (not normalized)."""
    literal_phrases: tuple[str, ...] = field(default=())

    def parsed(self) -> dict[str, Any]:
        """The `searchParsed` fields."""
        return {"mode": self.mode, "dateRange": self.date_range, "residualText": self.residual_text}


def parse_query(text: str, literal_phrases: list[str] | tuple[str, ...] = ()) -> Query:
    """The parsed form of a search's text. Whitespace-only text leaves an empty residual."""
    return Query(NORMAL, None, text.strip(), tuple(literal_phrases))


def normalize(text: str) -> str:
    """NFC, casefolded, and NFC again (casefolding can leave a decomposed character)."""
    return unicodedata.normalize("NFC", unicodedata.normalize("NFC", text).casefold())


def matches(name: str, needle: str) -> bool:
    """Whether `name` contains `needle`, an already normalized search text."""
    return needle in normalize(name)
