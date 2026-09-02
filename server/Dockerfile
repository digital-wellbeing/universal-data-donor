# Data-donation submission API (Flask + SQLite), fronted by Caddy at
# /datadonation/submit. Runs a single gunicorn worker with threads — plenty for
# a research study's submission volume and lets the in-process rate-limit lock
# stay effective.
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

# Donations DB lives on a mounted volume so it persists across restarts.
ENV DONATION_DB=/data/donations.sqlite
VOLUME /data
EXPOSE 8083

# Single worker (threaded) keeps the SQLite rate-limit lock coherent.
CMD ["gunicorn", "-b", "0.0.0.0:8083", "-w", "1", "--threads", "8", "--timeout", "60", "app:app"]
