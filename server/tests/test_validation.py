import math

import pytest
import validation
from validation import PayloadError, validate_donation

SID = "1234567890123456"


def donation(data, **extra):
    return {"submissionId": SID, **extra, "data": data}


def test_counts_tables_and_rows_itself():
    d = donation({"A": [{"x": 1}, {"x": 2}], "B": [{"y": "s"}]}, metadata={"totalRemainingRows": 10**9})
    assert validate_donation(d, "garmin") == (2, 3)


def test_scalar_cells_are_accepted():
    row = {"s": "text", "i": 3, "f": 1.5, "b": True, "n": None}
    assert validate_donation(donation({"T": [row]}), "garmin") == (1, 1)


@pytest.mark.parametrize("cell", [{"a": 1}, [1, 2], math.inf, -math.inf, math.nan])
def test_non_scalar_or_non_finite_cells_are_rejected(cell):
    with pytest.raises(PayloadError):
        validate_donation(donation({"T": [{"x": cell}]}), "garmin")


@pytest.mark.parametrize("sid", [None, 1234567890123456, "123", "12345678901234567", "abcdefghijklmnop", ""])
def test_submission_id_must_be_sixteen_digits(sid):
    d = donation({"T": []})
    d["submissionId"] = sid
    with pytest.raises(PayloadError):
        validate_donation(d, "garmin")


def test_unknown_top_level_key_is_rejected():
    with pytest.raises(PayloadError):
        validate_donation(donation({"T": []}, surprise=1), "garmin")


def test_platform_inside_the_donation_must_match():
    assert validate_donation(donation({"T": []}, platform="garmin"), "garmin") == (1, 0)
    with pytest.raises(PayloadError):
        validate_donation(donation({"T": []}, platform="fitbit"), "garmin")


@pytest.mark.parametrize("data", [[], "x", None, {"T": {"not": "a list"}}, {"T": ["row"]}, {1: []}])
def test_data_must_be_tables_of_row_objects(data):
    with pytest.raises(PayloadError):
        validate_donation(donation(data), "garmin")


def test_known_platforms_only_accept_their_own_tables():
    ok = {"Google Fit - Raw Heart Rate": [{"Start (UTC)": "t", "Heart Rate (bpm)": "70"}], "YouTube - Daily Activity": []}
    assert validate_donation(donation(ok), "googletakeout") == (2, 1)
    with pytest.raises(PayloadError):
        validate_donation(donation({"Anything Else": []}), "googletakeout")
    with pytest.raises(PayloadError):
        validate_donation(donation({"Raw Heart Rate": []}), "googletakeout")  # the googlefit name
    assert validate_donation(donation({"Raw Heart Rate": []}), "googlefit") == (1, 0)


def test_limits_are_enforced(monkeypatch):
    monkeypatch.setattr(validation, "MAX_TOTAL_ROWS", 2)
    with pytest.raises(PayloadError):
        validate_donation(donation({"T": [{"x": 1}] * 3}), "garmin")
    monkeypatch.setattr(validation, "MAX_TABLES", 1)
    with pytest.raises(PayloadError):
        validate_donation(donation({"A": [], "B": []}), "garmin")
    monkeypatch.setattr(validation, "MAX_COLUMNS", 1)
    with pytest.raises(PayloadError):
        validate_donation(donation({"T": [{"a": 1, "b": 2}]}), "garmin")
    monkeypatch.setattr(validation, "MAX_STR_LEN", 3)
    with pytest.raises(PayloadError):
        validate_donation(donation({"T": [{"a": "toolong"}]}), "garmin")
    monkeypatch.setattr(validation, "MAX_KEY_LEN", 2)
    with pytest.raises(PayloadError):
        validate_donation(donation({"T": [{"long key": 1}]}), "garmin")


def test_oversized_non_data_fields_are_rejected(monkeypatch):
    monkeypatch.setattr(validation, "MAX_NON_DATA_BYTES", 50)
    with pytest.raises(PayloadError):
        validate_donation(donation({"T": []}, parsingErrors={"x": "y" * 100}), "garmin")
