FROM rust:1-slim-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/nasa-hackathon /usr/local/bin/nasa-hackathon
COPY redline_local_map/web ./redline_local_map/web

ENV REDLINE_WEB_DIR=/app/redline_local_map/web
ENV PORT=8080
EXPOSE 8080

CMD ["nasa-hackathon", "--serve"]
