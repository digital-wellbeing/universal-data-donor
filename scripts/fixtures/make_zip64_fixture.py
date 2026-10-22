"""Build a tiny ZIP64 archive for src/utils/zipReader.test.js.

Lowering zipfile's limits forces ZIP64 extra fields and the ZIP64 end of
central directory record even for small entries.
Run: python3 scripts/fixtures/make_zip64_fixture.py
"""
import os
import zipfile

zipfile.ZIP64_LIMIT = 0
zipfile.ZIP_FILECOUNT_LIMIT = 0
out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "src", "utils", "__fixtures__", "zip64.zip"))
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
    z.writestr("apple_health_export/export.xml", "<HealthData>" + "<Record/>" * 1000 + "</HealthData>")
    z.writestr("second.txt", "second entry")
print(out, os.path.getsize(out))
