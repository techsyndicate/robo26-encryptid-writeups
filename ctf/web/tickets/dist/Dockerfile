FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt /app/requirements.txt
COPY src /app

RUN useradd -m ctf

USER ctf

RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5000

CMD ["python", "-m", "gunicorn", "app:app", "--bind", "0.0.0.0:5000", "--workers", "4"]
