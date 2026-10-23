FROM postgres:16-alpine
RUN apk add --no-cache python3 && mkdir -p /recovery /assets && chown -R 1000:1000 /recovery /assets
COPY worker.py /opt/recovery/worker.py
USER 1000:1000
ENTRYPOINT ["python3", "/opt/recovery/worker.py"]
