-- Schema for the donation store on MySQL (STORAGE_BACKEND=mysql).
--
-- Run ONCE by a database administrator, in the database the donations should live in
-- (for example `iema`), BEFORE switching the API over. The API's own account needs no
-- CREATE/ALTER rights: it only reads and inserts into these two tables.
--
--   mysql --ssl-mode=REQUIRED -h <host> -u <admin> -p <database> < server/mysql_schema.sql
--
-- Tables are prefixed `datadonation_` so they cannot collide with another application's
-- tables in the same database.
--
-- Why two tables: the payload is the sealed-box ciphertext of the whole donation, easily
-- 16 MiB and up to ~100 MiB, while a managed server's max_allowed_packet is often 16 MiB.
-- The API therefore stores the payload as <= 4 MiB chunks, in one transaction. The chunks
-- are ASCII (the payload is `enc:v1:` + base64), and the API refuses to store anything
-- that is not encrypted.

CREATE TABLE IF NOT EXISTS datadonation_donations (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id  CHAR(16)        NOT NULL,   -- the participant's withdrawal handle
  platform       VARCHAR(32)     NOT NULL,
  received_at    DATETIME(6)     NOT NULL,   -- UTC
  ip_hash        CHAR(32)        NULL,       -- salted HMAC of the client IP, never the IP
  user_agent     VARCHAR(300)    NULL,
  total_tables   INT UNSIGNED    NULL,
  total_rows     INT UNSIGNED    NULL,
  payload_bytes  BIGINT UNSIGNED NOT NULL,   -- length of the stored ciphertext string
  chunk_count    INT UNSIGNED    NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_datadonation_submission (submission_id),
  KEY idx_datadonation_platform_received (platform, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS datadonation_payload_chunks (
  donation_id BIGINT UNSIGNED NOT NULL,
  seq         INT UNSIGNED    NOT NULL,
  chunk       MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (donation_id, seq),
  CONSTRAINT fk_datadonation_chunk_donation
    FOREIGN KEY (donation_id) REFERENCES datadonation_donations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=ascii COLLATE=ascii_bin;

-- ---------------------------------------------------------------------------------------
-- The API's account (create it separately; let MySQL generate the password and keep that in
-- a host-only file, never in git). Least privilege: it can read and insert, nothing
-- else, and only on these two tables. It cannot delete, alter, drop or touch any other
-- table in the database.
--
--   CREATE USER 'datadonation'@'172.23.23.%' IDENTIFIED BY RANDOM PASSWORD
--     REQUIRE SSL;                  -- MySQL 8 prints the generated password once: copy it
--                                   -- straight into the host-only password file
--   GRANT SELECT, INSERT ON <database>.datadonation_donations      TO 'datadonation'@'172.23.23.%';
--   GRANT SELECT, INSERT ON <database>.datadonation_payload_chunks TO 'datadonation'@'172.23.23.%';
--
-- Withdrawal of a donation (a participant's right) is an administrator action:
--   DELETE FROM datadonation_donations WHERE submission_id = '<id>';   -- chunks cascade
