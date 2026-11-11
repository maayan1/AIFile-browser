"""Every protocol example validates against the schema its `type` names (AD-2, conventions)."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

PROTOCOL_DIR = Path(__file__).resolve().parents[2] / "protocol"
SCHEMAS = sorted((PROTOCOL_DIR / "schemas").glob("*.schema.json"))
EXAMPLES = sorted((PROTOCOL_DIR / "examples").glob("*.json"))


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def schema_for(message_type: str) -> dict:
    return load(PROTOCOL_DIR / "schemas" / f"{message_type}.schema.json")


def test_protocol_folder_is_populated() -> None:
    assert SCHEMAS and EXAMPLES


@pytest.mark.parametrize("path", SCHEMAS, ids=lambda p: p.name)
def test_schema_is_valid_draft7(path: Path) -> None:
    jsonschema.Draft7Validator.check_schema(load(path))


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.name)
def test_example_validates_against_its_type_schema(path: Path) -> None:
    example = load(path)
    jsonschema.Draft7Validator(schema_for(example["type"])).validate(example)


def test_every_schema_has_an_example() -> None:
    example_types = {load(p)["type"] for p in EXAMPLES}
    schema_types = {p.name.removesuffix(".schema.json") for p in SCHEMAS}
    assert schema_types <= example_types, f"schemas without an example: {schema_types - example_types}"


def test_every_error_code_is_listed_in_codes_json() -> None:
    codes = set(load(PROTOCOL_DIR / "codes.json")["errorCodes"])
    used = {load(p)["code"] for p in EXAMPLES if load(p)["type"] == "error"}
    assert used <= codes, f"codes missing from codes.json: {used - codes}"
    assert {"unknownRequest", "invalidRequest"} <= used  # both codes have an example


def test_engine_error_codes_are_listed_in_codes_json() -> None:
    import main
    from adapters import stdio_transport

    codes = set(load(PROTOCOL_DIR / "codes.json")["errorCodes"])
    assert {stdio_transport.UNKNOWN_REQUEST, stdio_transport.INVALID_REQUEST} <= codes
    assert {main.FOLDER_NOT_FOUND, main.ACCESS_DENIED, main.FOLDER_UNAVAILABLE} <= codes
