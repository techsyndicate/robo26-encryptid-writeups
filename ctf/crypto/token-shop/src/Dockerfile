FROM python:3.12-slim

WORKDIR /srv/token-shop
RUN python -m pip install --no-cache-dir flask gunicorn

COPY app.py ledger.py index.html flag.txt ./
COPY static ./static

RUN useradd --system --create-home token-shop && chown -R token-shop:token-shop /srv/token-shop
USER token-shop

ENV PORT=8080
EXPOSE ${PORT}

CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 1 --timeout 30 --graceful-timeout 10 --log-level warning app:app"]