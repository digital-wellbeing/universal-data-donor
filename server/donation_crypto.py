"""Public-key encryption of stored donations (libsodium sealed boxes).

The server only ever holds the PUBLIC key (DONATION_PUBLIC_KEY), so a stolen
database or a compromised server cannot decrypt donations. The matching private
key stays with the researchers and is used offline by `decrypt`.

Stored payload format:  "enc:v1:" + base64(sealed_box(json_bytes))

CLI:
  keygen <private_key_path>          Write a new private key (mode 0600), print the public key.
  encrypt-existing                   (server) encrypt any plaintext rows in DONATION_DB.
  decrypt <private_key_path> [file]  Decrypt a payload (from file or stdin) to JSON on stdout.
"""

import base64
import json
import os
import sqlite3
import sys

from nacl.public import PrivateKey, PublicKey, SealedBox

PREFIX = "enc:v1:"


def encrypt_payload(payload_json: str, public_key_b64: str) -> str:
    box = SealedBox(PublicKey(base64.b64decode(public_key_b64)))
    return PREFIX + base64.b64encode(box.encrypt(payload_json.encode("utf-8"))).decode("ascii")


def decrypt_payload(stored: str, private_key_b64: str) -> str:
    if not stored.startswith(PREFIX):
        return stored  # legacy plaintext row
    box = SealedBox(PrivateKey(base64.b64decode(private_key_b64)))
    return box.decrypt(base64.b64decode(stored[len(PREFIX):])).decode("utf-8")


def _keygen(path: str) -> None:
    sk = PrivateKey.generate()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(base64.b64encode(bytes(sk)).decode("ascii") + "\n")
    print(base64.b64encode(bytes(sk.public_key)).decode("ascii"))


def _encrypt_existing() -> None:
    public_key = os.environ["DONATION_PUBLIC_KEY"]
    conn = sqlite3.connect(os.environ["DONATION_DB"], timeout=30)
    rows = conn.execute("SELECT id, payload FROM donations WHERE payload NOT LIKE ?", (PREFIX + "%",)).fetchall()
    for row_id, payload in rows:
        conn.execute("UPDATE donations SET payload = ? WHERE id = ?", (encrypt_payload(payload, public_key), row_id))
    conn.commit()
    conn.execute("VACUUM")  # drop freed plaintext pages from the file
    conn.close()
    print(f"encrypted {len(rows)} existing row(s)")


def main(argv):
    if len(argv) >= 3 and argv[1] == "keygen":
        _keygen(argv[2])
    elif len(argv) == 2 and argv[1] == "encrypt-existing":
        _encrypt_existing()
    elif len(argv) >= 3 and argv[1] == "decrypt":
        private_key = open(argv[2]).read().strip()
        stored = (open(argv[3]) if len(argv) > 3 else sys.stdin).read().strip()
        sys.stdout.write(decrypt_payload(stored, private_key))
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main(sys.argv)
