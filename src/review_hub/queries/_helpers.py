"""Shared row-mapping helpers for Review Hub query modules."""
from __future__ import annotations


def _row_to_dict(row) -> dict | None:
    if row is None:
        return None
    return dict(row)


def _rows_to_list(rows) -> list[dict]:
    return [dict(r) for r in rows]
