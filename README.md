# WMATA Operator Dashboard

A real-time and historical operations dashboard for the Washington Metropolitan Area Transit Authority (WMATA) rail system. Built on the MEAN stack and fully containerized with Docker.

---

## Features

### Live Panels (30-second auto-refresh)
- **Rail Incidents** — Active service disruptions with affected lines and descriptions
- **Train Positions** — Live positions for all revenue trains, filterable by line (RD / BL / YL / OR / GR / SV)
- **Station Monitor** — Next-train arrival predictions for any of the 97 system stations
- **Schedule Adherence** — Per-train deviation from expected even-distribution headways, with network-wide and per-line summary bar and sortable deviation table

### Schedule Adherence — Historical Mode
Toggled directly on the adherence panel without affecting other panels:
- **Presets:** Last 3 hours, 24 hours, 7 days, or custom date range
- **Stacked area chart** (Chart.js) showing on-time / minor / significant percentages over time, bucketed automatically (5 min / 30 min / 3 h depending on range)
- **Summary stats:** average on-time %, worst period, best period
- **Drill-down table:** click any chart point to load the nearest full snapshot and inspect individual train deviations
- Line filter is shared with the live view and preserved when switching between modes

### Historical View (Global)
- Date-range fetch for **Rail Incidents** and **Elevator/Escalator Outages**
- Bar chart of record density per snapshot
- Step-through replay at 1.5 s/snapshot

### Background Poller
Every 30 seconds the server fetches incidents, train positions, and elevator outages from the WMATA API and persists each as a timestamped snapshot in MongoDB. Schedule adherence is computed from live train positions each cycle and stored with pre-aggregated per-line summaries.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21 (standalone components), Chart.js |
| Backend | Node.js, Express |
| Database | MongoDB (Mongoose) |
| Background jobs | node-cron |
| Container | Docker + Docker Compose, Nginx |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (recommended)
- OR Node.js 20+ and a running MongoDB instance for local dev
- A WMATA API key — register free at [developer.wmata.com](https://developer.wmata.com)

---

## Quick Start (Docker)

```bash
# 1. Clone the repo
git clone <repo-url>
cd wmta_dashboard

# 2. Create the root .env file
cp .env.example .env
# Fill in WMATA_API_KEY and confirm MONGODB_URI

# 3. Build and start all services
docker compose up --build
```

The app will be available at **http://localhost:4200**.

Startup order is enforced by healthchecks: MongoDB must be ready before the API starts, and the API must pass `GET /health` before Nginx starts serving the frontend.

---

## Local Development (without Docker)

### Backend

```bash
cd server
cp .env.example .env        # set WMATA_API_KEY and MONGODB_URI
npm install
npm run dev                  # nodemon with hot-reload on :3000
```

### Frontend

```bash
cd client
npm install
node node_modules/@angular/cli/bin/ng.js serve
# Proxies /api/* to http://localhost:3000 via proxy.conf.json
```

App available at **http://localhost:4200**.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `WMATA_API_KEY` | WMATA developer API key | — |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/wmata_dashboard` |
| `PORT` | Express listen port | `3000` |

**Local dev:** set in `server/.env`  
**Docker:** set in `.env` at the project root (read by `docker-compose.yml`)

> When running in Docker, `MONGODB_URI` must use the service name: `mongodb://mongo:27017/wmata_dashboard`

---

## Docker Commands

```bash
# Start all services (build if needed)
docker compose up --build

# Rebuild a single service
docker compose build api

# Stop and remove containers (keeps database volume)
docker compose down

# Stop and wipe the database
docker compose down -v
```

**Exposed ports:**

| Service | Host port |
|---|---|
| Angular (Nginx) | 4200 |
| Express API | 3000 |

---

## Project Structure

```
wmta_dashboard/
├── docker-compose.yml
├── .env.example
├── server/
│   ├── Dockerfile
│   └── src/
│       ├── index.js              # Express entry point, /health endpoint
│       ├── middleware/
│       │   └── wmata.js          # Axios client (base URL + API key)
│       ├── jobs/
│       │   └── poller.js         # node-cron 30 s job; adherence computation
│       ├── models/
│       │   ├── Incident.js
│       │   ├── TrainPosition.js
│       │   ├── ElevatorOutage.js
│       │   └── AdherenceSnapshot.js
│       └── routes/
│           ├── incidents.js      # /live + /history
│           ├── trains.js         # /live + /history
│           ├── elevators.js      # /live + /history
│           ├── predictions.js    # /live (no persistence)
│           └── adherence.js      # /live + /history + /snapshot
└── client/
    ├── Dockerfile
    ├── nginx.conf
    ├── proxy.conf.json           # dev proxy: /api → :3000
    └── src/app/
        ├── services/
        │   └── wmata.service.ts  # all HTTP calls, relative /api base
        └── components/
            ├── dashboard/
            ├── incidents-panel/
            ├── train-positions-panel/
            ├── station-monitor/
            ├── adherence-panel/  # live + self-contained historical with chart
            └── historical-view/  # incidents & elevator history
```

---

## Schedule Adherence Algorithm

WMATA does not publish scheduled train times. Adherence is computed using an **even-distribution headway model**:

1. For each line + direction, retrieve the ordered circuit sequence from the WMATA Standard Routes endpoint (cached 10 minutes in-process).
2. Sort active revenue trains by their current circuit sequence number.
3. Compute the ideal position for each train assuming uniform spacing: `expectedSeq = routeLength / (n + 1) × (i + 1)`.
4. Measure deviation: `|currentSeq − expectedSeq|`.
5. Classify against the headway: ≤ 10% = **on-time**, ≤ 25% = **minor**, > 25% = **significant**.

Each 30-second snapshot stores per-train detail plus pre-aggregated network and per-line summaries, so historical queries can return summary data without re-scanning the trains array.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| GET | `/api/incidents/live` | Active rail incidents (WMATA pass-through) |
| GET | `/api/incidents/history?from=&to=` | Historical incident snapshots |
| GET | `/api/trains/live` | Live train positions |
| GET | `/api/trains/history?from=&to=&line=` | Historical train position snapshots |
| GET | `/api/elevators/live` | Active elevator/escalator outages |
| GET | `/api/elevators/history?from=&to=` | Historical outage snapshots |
| GET | `/api/predictions/:stationCode` | Next-train predictions for a station |
| GET | `/api/adherence/live` | Most recent adherence snapshot (full detail) |
| GET | `/api/adherence/history?from=&to=&line=` | Historical adherence summaries |
| GET | `/api/adherence/snapshot?at=` | Full snapshot nearest to a given timestamp |
