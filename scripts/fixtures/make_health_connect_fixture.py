"""Build the SYNTHETIC Health Connect export used by healthConnectParser.test.js.

The schema mirrors AOSP HealthFitness (RecordHelper / IntervalRecordHelper /
InstantRecordHelper / SeriesRecordHelper, incl. generated local-time columns).
Values are fake. Run: python3 scripts/fixtures/make_health_connect_fixture.py
"""
import os
import sqlite3
import tempfile
import uuid
import zipfile

BASE = ("row_id INTEGER PRIMARY KEY AUTOINCREMENT, uuid BLOB NOT NULL UNIQUE, last_modified_time INTEGER, "
        "client_record_id TEXT, client_record_version TEXT, device_info_id INTEGER, app_info_id INTEGER, "
        "recording_method INTEGER, dedupe_hash BLOB UNIQUE")
INTERVAL = "start_time INTEGER, start_zone_offset INTEGER, end_time INTEGER, end_zone_offset INTEGER, local_date INTEGER"
INSTANT = "time INTEGER, zone_offset INTEGER, local_date INTEGER"
GEN_INTERVAL = ("local_date_time_start_time INTEGER AS (start_time + 1000 * start_zone_offset), "
                "local_date_time_end_time INTEGER AS (end_time + 1000 * end_zone_offset)")
GEN_INSTANT = "local_date_time INTEGER AS (time + 1000 * zone_offset)"
FKS = ("FOREIGN KEY (device_info_id) REFERENCES device_info_table(row_id) ON DELETE CASCADE, "
       "FOREIGN KEY (app_info_id) REFERENCES application_info_table(row_id) ON DELETE CASCADE")
INTERVAL_TABLES = {
    "steps_record_table": "count INTEGER",
    "distance_record_table": "distance REAL",
    "active_calories_burned_record_table": "energy REAL",
    "total_calories_burned_record_table": "energy REAL",
    "floors_climbed_record_table": "floors REAL",
    "heart_rate_record_table": None,
    "sleep_session_record_table": "notes TEXT, title TEXT",
    "exercise_session_record_table": "notes TEXT, exercise_type INTEGER, title TEXT, has_route INTEGER, "
                                     "planned_exercise_session_id BLOB",
}
INSTANT_TABLES = {
    "resting_heart_rate_record_table": "beats_per_minute INTEGER",
    "heart_rate_variability_rmssd_record_table": "heart_rate_variability_millis REAL NOT NULL",
    "oxygen_saturation_record_table": "percentage REAL",
    "respiratory_rate_record_table": "rate REAL",
    "weight_record_table": "weight REAL",
}
CHILD_TABLES = {
    "heart_rate_record_series_table": ("heart_rate_record_table",
                                       "parent_key INTEGER, beats_per_minute INTEGER, epoch_millis INTEGER"),
    "sleep_stages_table": ("sleep_session_record_table",
                           "parent_key INTEGER NOT NULL, stage_start_time INTEGER NOT NULL, "
                           "stage_end_time INTEGER NOT NULL, stage_type INTEGER NOT NULL"),
    "exercise_route_table": ("exercise_session_record_table",
                             "parent_key INTEGER NOT NULL, timestamp_millis INTEGER NOT NULL, longitude REAL NOT NULL, "
                             "latitude REAL NOT NULL, horizontal_accuracy REAL NOT NULL, "
                             "vertical_accuracy REAL NOT NULL, altitude REAL NOT NULL"),
}

OFF = 3600                 # +01:00, in seconds
T0 = 1767225600000         # 2026-01-01T00:00:00Z
MIN = 60_000
HOUR = 60 * MIN
_n = [0]


def uid():
    _n[0] += 1
    return uuid.UUID(int=0x1234_5678_9abc_4def_8000_000000000000 + _n[0]).bytes


def interval(con, table, app, start, end, cols="", vals=()):
    names = "uuid, app_info_id, device_info_id, recording_method, start_time, start_zone_offset, end_time, end_zone_offset, local_date"
    values = [uid(), app, 1, 2, start, OFF, end, OFF, (start + OFF * 1000) // 86400000]
    if cols:
        names += ", " + cols
        values += list(vals)
    q = ",".join("?" * len(values))
    return con.execute(f"INSERT INTO {table} ({names}) VALUES ({q})", values).lastrowid


def instant(con, table, app, t, col, val):
    con.execute(f"INSERT INTO {table} (uuid, app_info_id, time, zone_offset, local_date, {col}) VALUES (?,?,?,?,?,?)",
                (uid(), app, t, OFF, (t + OFF * 1000) // 86400000, val))


def main():
    out_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "src", "parsers", "__fixtures__"))
    with tempfile.TemporaryDirectory() as tmp:
        db = os.path.join(tmp, "health_connect_export.db")
        con = sqlite3.connect(db)
        con.execute("PRAGMA page_size = 4096")
        con.execute("PRAGMA user_version = 20")
        con.execute("CREATE TABLE android_metadata (locale TEXT)")
        con.execute("CREATE TABLE application_info_table (row_id INTEGER PRIMARY KEY, package_name TEXT NOT NULL UNIQUE, "
                    "app_name TEXT, app_icon BLOB, record_types_used TEXT)")
        con.execute("CREATE TABLE device_info_table (row_id INTEGER PRIMARY KEY, manufacturer TEXT, model TEXT, device_type INTEGER)")
        for name, cols in INTERVAL_TABLES.items():
            con.execute(f"CREATE TABLE {name} ({BASE}, {INTERVAL}{', ' + cols if cols else ''}, {GEN_INTERVAL}, {FKS})")
        for name, cols in INSTANT_TABLES.items():
            con.execute(f"CREATE TABLE {name} ({BASE}, {INSTANT}, {cols}, {GEN_INSTANT}, {FKS})")
        for name, (parent, cols) in CHILD_TABLES.items():
            con.execute(f"CREATE TABLE {name} ({cols}, FOREIGN KEY (parent_key) REFERENCES {parent}(row_id) ON DELETE CASCADE)")

        con.execute("INSERT INTO application_info_table VALUES (1,'com.google.android.apps.fitness','Fit',NULL,NULL)")
        con.execute("INSERT INTO application_info_table VALUES (2,'com.sec.android.app.shealth','Samsung Health',NULL,NULL)")
        con.execute("INSERT INTO device_info_table VALUES (1,'Samsung','SM-R960',1)")

        d = T0  # 2026-01-01 (local +01:00)
        # Two apps write overlapping steps: Fit 5000, Samsung Health 5500 -> 5500.
        interval(con, "steps_record_table", 1, d + 8 * HOUR, d + 9 * HOUR, "count", (3000,))
        interval(con, "steps_record_table", 1, d + 17 * HOUR, d + 18 * HOUR, "count", (2000,))
        interval(con, "steps_record_table", 2, d + 8 * HOUR, d + 18 * HOUR, "count", (5500,))
        # 23:30Z is 00:30 local on Jan 2.
        interval(con, "steps_record_table", 2, d + 23 * HOUR + 30 * MIN, d + 23 * HOUR + 40 * MIN, "count", (300,))
        interval(con, "distance_record_table", 2, d + 8 * HOUR, d + 18 * HOUR, "distance", (4200.0,))
        interval(con, "active_calories_burned_record_table", 2, d + 8 * HOUR, d + 18 * HOUR, "energy", (250000.0,))
        interval(con, "total_calories_burned_record_table", 2, d, d + 24 * HOUR - 1, "energy", (2100000.0,))
        interval(con, "floors_climbed_record_table", 2, d + 9 * HOUR, d + 9 * HOUR + MIN, "floors", (4.0,))

        hr = interval(con, "heart_rate_record_table", 2, d + 10 * HOUR, d + 19 * HOUR)
        con.executemany("INSERT INTO heart_rate_record_series_table VALUES (?,?,?)", [
            (hr, 60, d + 10 * HOUR), (hr, 80, d + 11 * HOUR), (hr, 100, d + 12 * HOUR),
            (hr, 140, d + 18 * HOUR + 5 * MIN), (hr, 160, d + 18 * HOUR + 20 * MIN),
        ])
        instant(con, "resting_heart_rate_record_table", 2, d + 7 * HOUR, "beats_per_minute", 55)
        instant(con, "heart_rate_variability_rmssd_record_table", 2, d + 3 * HOUR, "heart_rate_variability_millis", 42.5)
        instant(con, "oxygen_saturation_record_table", 2, d + 3 * HOUR, "percentage", 96.5)
        instant(con, "respiratory_rate_record_table", 2, d + 3 * HOUR, "rate", 14.2)
        instant(con, "weight_record_table", 2, d + 7 * HOUR, "weight", 70123.0)

        # Night of Dec 31 -> Jan 1: staged session (Samsung Health) + unstaged one (Fit).
        s0 = d - 90 * MIN  # 22:30Z
        sl = interval(con, "sleep_session_record_table", 2, s0, d + 6 * HOUR + 30 * MIN, "notes, title",
                      ("slept badly after argument", "Sleep at home"))
        stages = [(s0, 180, 4), (s0 + 180 * MIN, 60, 5), (s0 + 240 * MIN, 10, 1), (s0 + 250 * MIN, 90, 6), (s0 + 340 * MIN, 140, 4)]
        for start, mins, st in stages:
            con.execute("INSERT INTO sleep_stages_table VALUES (?,?,?,?)", (sl, start, start + mins * MIN, st))
        interval(con, "sleep_session_record_table", 1, d - 2 * HOUR, d + 6 * HOUR, "notes, title", (None, None))

        ex = interval(con, "exercise_session_record_table", 1, d + 18 * HOUR, d + 18 * HOUR + 30 * MIN,
                      "notes, exercise_type, title, has_route", ("felt great", 33, "Run round Elm Street", 1))
        con.executemany("INSERT INTO exercise_route_table VALUES (?,?,?,?,?,?,?)",
                        [(ex, d + 18 * HOUR + i * MIN, -0.5876, 51.2432, 3.0, 3.0, 40.0) for i in range(3)])
        interval(con, "exercise_session_record_table", 2, d + 20 * HOUR, d + 20 * HOUR + 45 * MIN,
                 "exercise_type", (999,))
        con.commit()
        con.close()

        out = os.path.join(out_dir, "health_connect_export.zip")
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(db, "health_connect_export.db")
    print(out, os.path.getsize(out))


if __name__ == "__main__":
    main()
