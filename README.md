# Lumina Backend

> Stellar event indexer + Apollo GraphQL API + PostgreSQL schema for Lumina, an open-source event indexer and GraphQL data layer for the Stellar network.

Part of the Lumina project, split across three repos:

- [lumina-frontend](https://github.com/Lumeeena/lumina-frontend) — Next.js explorer UI
- [lumina-backend](https://github.com/Lumeeena/lumina-backend) — this repo
- [lumina-contracts](https://github.com/Lumeeena/lumina-contracts) — Soroban Registry contract

## Structure

```
indexer/         Polls Stellar Horizon, writes ledgers/transactions/operations/accounts
                  to Postgres, and (opt-in) indexes Soroban contract events via RPC
graphql-server/   Apollo GraphQL API — reads from Postgres, falls back to Horizon
                  only for accounts that haven't been indexed yet
db/               PostgreSQL schema + migrations
docker/           Dockerfiles + docker-compose.yml for postgres + indexer + graphql
```

## How It Works

```
Stellar Horizon ──▶ indexer/ ──▶ PostgreSQL ──▶ graphql-server/ ──▶ lumina-frontend
                                                       ▲
                        Soroban RPC (contract events) ─┘  (opt-in, see below)
                                       ▲
              Lumina Registry (lumina-contracts) ─┘  (opt-in discovery, see below)
```

A [Lumina Registry](https://github.com/Lumeeena/lumina-contracts) is deployed
on testnet at `CAYUDQPV3RKPM3EXDFGI3457FV677JLUCJ4OLKWGCUBPRIHYKXK3WFAZ` with
one demo entry (itself), used to verify the discovery wiring below end-to-end
against a live contract.

## Run with Docker

```bash
docker compose -f docker/docker-compose.yml up
```

- GraphQL: http://localhost:4000/graphql
- PostgreSQL: localhost:5432

## Run locally

```bash
# once
psql $DATABASE_URL -f db/schema.sql

# indexer
cd indexer && npm install && npm run dev

# graphql server
cd graphql-server && npm install && npm run dev
```

### Indexer environment variables

| Variable | Default | Notes |
|---|---|---|
| `HORIZON_URL` | `https://horizon.stellar.org` | |
| `DATABASE_URL` | `postgresql://localhost:5432/lumina` | |
| `START_LEDGER` | latest | Only used when the DB is empty |
| `POLL_INTERVAL_MS` | `5000` | |
| `SOROBAN_RPC_URL` | unset | Enables Soroban contract event indexing |
| `INDEXED_CONTRACT_IDS` | unset | Comma-separated contract IDs to index events for; requires `SOROBAN_RPC_URL` |
| `REGISTRY_CONTRACT_ID` | unset | Lumina Registry contract to poll for additional contract IDs; requires `SOROBAN_RPC_URL` + `REGISTRY_READ_ACCOUNT` |
| `REGISTRY_READ_ACCOUNT` | unset | Any funded G... account used to simulate the registry's read calls — no secret key needed, simulation doesn't sign or submit |
| `REGISTRY_NETWORK_PASSPHRASE` | Test SDF Network passphrase | Network the registry is deployed on |

Soroban event indexing and registry discovery are both entirely opt-in — the
indexer behaves exactly as it did before these variables were introduced
when they're unset. When `REGISTRY_CONTRACT_ID` is set, discovered contract
IDs are merged with `INDEXED_CONTRACT_IDS` (the registry is polled roughly
once a minute, independent of the 5s ledger poll loop).

Example against the deployed testnet registry:

```bash
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org \
REGISTRY_CONTRACT_ID=CAYUDQPV3RKPM3EXDFGI3457FV677JLUCJ4OLKWGCUBPRIHYKXK3WFAZ \
REGISTRY_READ_ACCOUNT=<any funded testnet G... address> \
npm run dev
```

### GraphQL server environment variables

| Variable | Default |
|---|---|
| `DATABASE_URL` | `postgresql://localhost:5432/lumina` |
| `PORT` | `4000` |

## Testing

```bash
npm test   # runs indexer + graphql-server test suites
```

## License

MIT
