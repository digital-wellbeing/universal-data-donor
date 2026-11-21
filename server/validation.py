"""Server-side validation of a donation package.

The frontend builds the package, but nothing stops a caller from POSTing any
JSON they like once they hold a valid Turnstile token. Turnstile proves a human
(or a CAPTCHA farm) was present, not that the data is what the app produces, so
the server re-checks the shape and bounds of everything it stores:

  * `donation.data` is {table name: [row, ...]} with sane limits on the number
    of tables, rows, columns and string lengths, and only finite scalar cells;
  * for platforms whose tables are known, only those table names are accepted;
  * only known top-level keys, with a size cap on everything except `data`;
  * the submission id has the format the app generates.

Totals are counted here, never taken from the client's own `metadata`.

Encrypted envelopes (opt-in browser-side encryption) are validated separately, see
`validate_envelope`: the server cannot see inside them.
"""

import base64
import binascii
import json
import math
import re

# Limits are deliberately generous (an 80 MiB body holds ~700k short rows) but finite.
MAX_TABLES = 50
MAX_TOTAL_ROWS = 1_500_000
MAX_COLUMNS = 60
MAX_KEY_LEN = 100
MAX_STR_LEN = 2000
MAX_TABLE_NAME_LEN = 100
MAX_NON_DATA_BYTES = 1024 * 1024

SUBMISSION_ID_RE = re.compile(r"^\d{16}$")

ALLOWED_TOP_LEVEL_KEYS = {
    "submissionId", "timestamp", "platform", "data", "deletedRowCounts",
    "parsingErrors", "windowFilter", "appliedFilters", "metadata", "studyInfo",
}

# Optional study label from the page URL (`?study=...&ethics=...`): null, or an object whose
# only keys are study and ethics, each null or a short string. The client cleans and caps both
# at 120 characters; this is only a label, never proof of ethics approval.
STUDY_INFO_KEYS = {"study", "ethics"}
MAX_STUDY_INFO_LEN = 120

# Exact table names for platforms whose parsers are known. Other platforms get the
# structural checks only (their tables are not enumerated here).
_FIT_TABLES = (
    "Daily Activity", "Activity Sessions", "Raw Heart Rate", "Raw Steps", "Raw Distance",
    "Raw Calories", "Raw Activity Segments", "Raw Sleep Segments",
)
KNOWN_TABLES = {
    "googlefit": set(_FIT_TABLES),
    "googletakeout": (
        {f"Google Fit - {name}" for name in _FIT_TABLES}
        | {"Google Health - Daily Activity", "Google Health - Sleep", "Google Health - Exercise",
           "Play Games - Daily Playtime", "Play Games - Game Activity",
           "YouTube - Viewing Sessions", "YouTube - Daily Activity"}
    ),
}


class PayloadError(ValueError):
    """The donation is not acceptable. The message is for server logs only."""


def _check_rows(table, rows, seen_keys):
    """Validate one table's rows; returns how many there are."""
    if type(rows) is not list:
        raise PayloadError(f"table {table!r}: rows are not a list")
    for row in rows:
        if type(row) is not dict or len(row) > MAX_COLUMNS:
            raise PayloadError(f"table {table!r}: a row is not an object or has too many columns")
        for key, value in row.items():
            if key not in seen_keys:  # keys repeat on every row: check each distinct key once
                if type(key) is not str or len(key) > MAX_KEY_LEN:
                    raise PayloadError(f"table {table!r}: bad column name")
                seen_keys.add(key)
            kind = type(value)
            if kind is str:
                if len(value) > MAX_STR_LEN:
                    raise PayloadError(f"table {table!r}: a cell is too long")
            elif kind is int or kind is bool or value is None:
                continue
            elif kind is float:
                if not math.isfinite(value):
                    raise PayloadError(f"table {table!r}: non-finite number")
            else:
                raise PayloadError(f"table {table!r}: a cell is not a scalar")
    return len(rows)


def _check_study_info(info):
    """studyInfo is absent, null, or {study, ethics} with each value null or a short string."""
    if info is None:
        return
    if type(info) is not dict or not set(info) <= STUDY_INFO_KEYS:
        raise PayloadError("studyInfo is not null or an object with only study and ethics")
    for value in info.values():
        if value is not None and (type(value) is not str or len(value) > MAX_STUDY_INFO_LEN):
            raise PayloadError("studyInfo values must be null or strings of at most 120 characters")


def validate_donation(donation, platform):
    """Validate `donation` for `platform`; return (total_tables, total_rows).

    Raises PayloadError on anything unacceptable.
    """
    if type(donation) is not dict:
        raise PayloadError("donation is not an object")

    unknown = set(donation) - ALLOWED_TOP_LEVEL_KEYS
    if unknown:
        raise PayloadError(f"unexpected top-level keys: {sorted(map(str, unknown))[:5]}")

    submission_id = donation.get("submissionId")
    if type(submission_id) is not str or not SUBMISSION_ID_RE.match(submission_id):
        raise PayloadError("submissionId is missing or not a 16-digit string")

    declared = donation.get("platform")
    if declared is not None and str(declared).lower() != platform:
        raise PayloadError("platform inside the donation differs from the request platform")

    _check_study_info(donation.get("studyInfo"))

    non_data = {k: v for k, v in donation.items() if k != "data"}
    try:
        if len(json.dumps(non_data)) > MAX_NON_DATA_BYTES:
            raise PayloadError("non-data fields are too large")
    except (TypeError, ValueError) as exc:
        raise PayloadError(f"non-data fields are not valid JSON values: {exc}") from exc

    data = donation.get("data")
    if type(data) is not dict or len(data) > MAX_TABLES:
        raise PayloadError("data is not an object, or has too many tables")

    allowed = KNOWN_TABLES.get(platform)
    total_rows = 0
    for table, rows in data.items():
        if type(table) is not str or len(table) > MAX_TABLE_NAME_LEN:
            raise PayloadError("bad table name")
        if allowed is not None and table not in allowed:
            raise PayloadError(f"table {table[:60]!r} is not known for platform {platform!r}")
        total_rows += _check_rows(table, rows, set())
        if total_rows > MAX_TOTAL_ROWS:
            raise PayloadError("too many rows in total")
    return len(data), total_rows


# --- Encrypted envelopes (browser-side encryption, see src/utils/encryptDonation.js) ---
# The browser seals the whole package to the study's public key, so the server cannot
# look inside. It validates the envelope and a CLIENT-REPORTED summary of table names and
# row counts; the contents can only be checked after decryption with the offline key.

ENVELOPE_KEYS = {"v", "submissionId", "summary", "payload"}
SEALED_PREFIX = "enc:v1:"
SEALED_BOX_OVERHEAD = 48  # libsodium crypto_box_seal: 32-byte ephemeral key + 16-byte MAC


def _is_count(value):
    return type(value) is int and 0 <= value <= MAX_TOTAL_ROWS


def validate_envelope(envelope, platform, max_payload_chars):
    """Validate an encrypted envelope; return the client-reported (tables, rows).

    Raises PayloadError on anything unacceptable.
    """
    if type(envelope) is not dict or set(envelope) != ENVELOPE_KEYS:
        raise PayloadError("envelope is not an object with exactly v, submissionId, summary, payload")
    if type(envelope["v"]) is not int or envelope["v"] != 1:
        raise PayloadError("unsupported envelope version")

    submission_id = envelope["submissionId"]
    if type(submission_id) is not str or not SUBMISSION_ID_RE.match(submission_id):
        raise PayloadError("submissionId is missing or not a 16-digit string")

    summary = envelope["summary"]
    if type(summary) is not dict or set(summary) != {"tables", "totalRows"}:
        raise PayloadError("summary is not an object with exactly tables and totalRows")
    tables = summary["tables"]
    if type(tables) is not dict or len(tables) > MAX_TABLES:
        raise PayloadError("summary.tables is not an object, or has too many tables")
    allowed = KNOWN_TABLES.get(platform)
    total = 0
    for name, count in tables.items():
        if type(name) is not str or len(name) > MAX_TABLE_NAME_LEN:
            raise PayloadError("bad table name in summary")
        if allowed is not None and name not in allowed:
            raise PayloadError(f"table {name[:60]!r} is not known for platform {platform!r}")
        if not _is_count(count):
            raise PayloadError("bad row count in summary")
        total += count
    if total > MAX_TOTAL_ROWS or not _is_count(summary["totalRows"]) or summary["totalRows"] != total:
        raise PayloadError("summary totalRows is inconsistent or too large")

    payload = envelope["payload"]
    if type(payload) is not str or not payload.startswith(SEALED_PREFIX) or len(payload) > max_payload_chars:
        raise PayloadError("payload is not an enc:v1: string of acceptable size")
    try:
        sealed = base64.b64decode(payload[len(SEALED_PREFIX):], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise PayloadError("payload is not valid base64") from exc
    if len(sealed) <= SEALED_BOX_OVERHEAD:
        raise PayloadError("payload is too short to be a sealed box")
    return len(tables), total
