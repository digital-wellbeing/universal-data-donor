"""Test setup: configure the environment BEFORE app.py is imported (it reads it at import)."""
import base64
import os
import sys
import tempfile

from nacl.public import PrivateKey

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SERVER_DIR)

_tmp = tempfile.mkdtemp(prefix="donation-tests-")
os.environ["DONATION_DB"] = os.path.join(_tmp, "donations.sqlite")
os.environ["DONATION_PUBLIC_KEY"] = base64.b64encode(bytes(PrivateKey.generate().public_key)).decode()
os.environ["REQUIRE_ENCRYPTION"] = "1"
os.environ["MAX_BYTES"] = str(64 * 1024 * 1024)
os.environ["MIN_FREE_BYTES"] = "1"   # tests that need a "full" disk raise it explicitly
os.environ["RATE_MAX"] = "1000"
