FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
EXPOSE 5173
CMD ["sleep", "infinity"]
