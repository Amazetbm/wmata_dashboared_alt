# WMATA Operator Dashboard

A real-time and historical operations dashboard for the Washington Metropolitan Area Transit Authority (WMATA) rail and bus systems. Built on the MEAN stack and fully containerized with Docker.

---

## Features

### Navigation

Two top-level views are served as separate Angular routes, accessible from the persistent navigation bar:

| Route | View |
|---|---|
| `/rail` | Rail Dashboard — all rail panels |
| `/bus` | Bus Map — full-page live bus network map |

An **Ask the Dashboard** button in the nav bar opens the AI assistant panel (see below). The button is hidden automatically when the assistant is not configured.

---

### Rail Dashboard (`/rail`)

All rail panels auto-refresh every 30 seconds.

**Rail Map**
- Full-screen Leaflet map showing live train positions on their actual track geometry
- Each line rendered as a color-coded polyline (RD / BL / YL / OR / GR / SV)
- Trains shown as directional markers; pulsing amber ring on incident-affected segments
- Station markers show name, served lines, and active incident summaries in popups
- Layer controls to toggle trains, stations, and incidents independently

**Rail Incidents**
- Active service disruptions with affected lines and descriptions

**Train Positions**
- Live positions for all revenue trains, filterable by line

**Station Monitor**
- Next-train arrival predictions for any of the 97 system stations

**Elevator & Escalator Outages**
- Active elevator and escalator outages with unit type, station, location description, and estimated return to service

**Schedule Adherence**
- Per-train deviation from expected even-distribution headways
- Network-wide and per-line summary bar with on-time / minor / significant breakdown
- Sortable deviation table

**Schedule Adherence — Historical Mode**

Toggled directly on the adherence panel without affecting other panels:
- Presets: Last 3 hours, 24 hours, 7 days, or custom date range
- Stacked area chart (Chart.js) showing on-time / minor / significant percentages over time, bucketed automatically (5 min / 30 min / 3 h depending on range)
- Summary stats: average on-time %, worst period, best period
- Drill-down table: click any chart point to load the nearest full snapshot and inspect individual train deviations
- Line filter shared with live view, preserved across mode switches

**Historical View**
- Date-range fetch for Rail Incidents and Elevator/Escalator Outages
- Bar chart of record density per snapshot
- Step-through replay at 1.5 s/snapshot

---

### Bus Map (`/bus`)

Full-page Leaflet map of the live WMATA bus network, lazily loaded as a separate Angular chunk.

- **Live bus positions** — all active vehicles plotted, colored deterministically by route
- **Marker clustering** — `Leaflet.markercluster` groups nearby buses at lower zoom levels; clusters show vehicle count and expand on click
- **Route polylines** — shape geometry for each active route (both directions), fetched lazily and cached server-side for 1 hour per route
- **Bus stops** — shown as small circle markers at zoom ≥ 14; hidden at lower zoom to reduce visual clutter
- **Incident highlights** — buses on routes with active incidents get an amber pulse ring; affected route polylines are drawn in amber
- **Route search** — type a route ID or headsign to filter markers and polylines to that route only; clear button resets the view
- **Incident sidebar** — scrollable list of all active bus incidents with affected route chips, incident type, and description; click an incident to pan the map to its first affected bus and highlight the sidebar entry
- **Bidirectional sync** — clicking a bus popup's "Show incidents" button scrolls and highlights the matching sidebar entry
- **30-second auto-refresh** — positions, incidents, and shapes refresh automatically

---

### Ask the Dashboard (AI Assistant)

A slide-out chat panel that lets operators ask plain-English questions about live and historical WMATA data and receive answers from a large language model.

**How it works**
1. The backend runs an agentic tool-calling loop (up to 5 iterations) against your configured LLM provider.
2. The LLM selects from 7 read-only data tools to answer each question; tool calls run in parallel.
3. The final answer is returned as rendered markdown in the panel.
4. If the answer references a specific line, station, or bus route the map is updated automatically — no manual navigation required.

**Available tools**

| Tool | What it does |
|---|---|
| `find_station` | Fuzzy-match a station name to its WMATA code; required before `get_next_trains` |
| `get_rail_incidents` | Live active incidents or historical aggregates |
| `get_train_positions` | Most recent adherence snapshot, optionally filtered by line |
| `get_next_trains` | Live next-arrival predictions for a station |
| `get_elevator_outages` | Live outages or historical outage records with ADA-concern flagging |
| `get_schedule_adherence` | Live, point-in-time snapshot, or multi-day historical summary |
| `get_bus_incidents` | Historical bus incident aggregates by route |

**Map integration**

When the LLM references a specific line, station, or bus route it emits a `show_on_map` action. The Angular `MapCommandService` receives the action and drives the Leaflet map directly:

| Action | Effect |
|---|---|
| `focus_line` | Selects and highlights the rail line |
| `focus_station` | Pans the rail map to the station and opens its popup |
| `focus_route` | Filters the bus map to that route |

The bus map is a lazy-loaded chunk; any `focus_route` action that arrives before it finishes loading is queued and applied automatically once it is ready.

**Provider support**

The assistant is provider-agnostic. Configure any of the following via environment variables:

| Provider | `LLM_PROVIDER` value |
|---|---|
| Anthropic (Claude) | `anthropic` |
| OpenAI | `openai` |
| Google Gemini | `gemini` |
| Ollama / any OpenAI-compatible API | `openai-compatible` |

Set `ASSISTANT_ENABLED=false` to disable the feature without removing the environment variables. The server always starts regardless of assistant configuration.

**Rate limiting**

`POST /api/assistant/chat` is rate-limited to 10 requests per minute per IP. The API key is never sent to the browser; `/api/assistant/config` returns only `{ enabled, provider, model }`.

---

### MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server exposing live WMATA data as tools for AI clients (Claude Code, Claude Desktop, MCP Inspector). Accessible at `/mcp` via the nginx reverse proxy.

**Five tools:**

| Tool | What it does |
|---|---|
| `next_arrivals` | Next-train arrival predictions for a station code |
| `line_status` | Active rail incidents filtered by line |
| `accessibility_status` | Active elevator and escalator outages |
| `service_history` | Historical schedule-adherence summaries |
| `live_trains` | Current train positions and adherence snapshot |

**Security:** Every request requires `Authorization: Bearer <MCP_AUTH_TOKEN>`. The server refuses to start in HTTP mode without a token.

**Connecting:**

```bash
# Claude Code
claude mcp add --transport http wmata http://localhost:4200/mcp \
  --header "Authorization: Bearer <token>"

# MCP Inspector
# URL: http://localhost:4200/mcp  — add Authorization header in the UI

# Claude Desktop (claude_desktop_config.json)
# "mcpServers": { "wmata": { "url": "http://localhost:4200/mcp",
#   "headers": { "Authorization": "Bearer <token>" } } }
```

---

### Background Poller

Every 30 seconds the server fetches rail incidents, train positions, elevator outages, bus positions, and bus incidents from the WMATA API and persists each as a timestamped snapshot in MongoDB. Schedule adherence is computed from live train positions each cycle and stored with pre-aggregated per-line summaries.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 21 (standalone components), Chart.js, Leaflet, Leaflet.markercluster, marked |
| Backend | Node.js, Express, express-rate-limit |
| Database | MongoDB (Mongoose) |
| Background jobs | node-cron |
| MCP SDK | @modelcontextprotocol/sdk — Streamable HTTP transport |
| Container | Docker + Docker Compose, Nginx |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (recommended)
- OR Node.js 20+ and a running MongoDB instance for local dev
- A WMATA API key — register free at [developer.wmata.com](https://developer.wmata.com)
- *(Optional)* An LLM API key or a local [Ollama](https://ollama.com) instance for the AI assistant

---

## Quick Start (Docker)

```bash
# 1. Clone the repo
git clone <repo-url>
cd wmta_dashboard

# 2. Create the root .env file
cp .env.example .env
# Fill in WMATA_API_KEY and (optionally) LLM_* variables

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

### MCP Server

```bash
cd mcp
npm install
npm run build   # dist/ is gitignored — must build after clone

# HTTP mode (requires token)
MCP_AUTH_TOKEN=test node dist/index.js

# stdio mode (for Claude Code CLI attachment)
MCP_TRANSPORT=stdio node dist/index.js
```

---

## Environment Variables

### Required

| Variable | Description | Default |
|---|---|---|
| `WMATA_API_KEY` | WMATA developer API key | — |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/wmata_dashboard` |
| `PORT` | Express listen port | `3000` |

### AI Assistant (optional)

| Variable | Description | Default |
|---|---|---|
| `LLM_PROVIDER` | `anthropic`, `openai`, `gemini`, or `openai-compatible` | — |
| `LLM_MODEL` | Model name (e.g. `claude-sonnet-4-6`, `gpt-4o`, `qwen3:8b`) | — |
| `LLM_API_KEY` | API key for the chosen provider; leave blank for local servers | — |
| `LLM_BASE_URL` | Base URL override; required for `openai-compatible` (e.g. `http://localhost:11434`) | — |
| `LLM_MAX_TOKENS` | Maximum tokens in the LLM response | `1024` |
| `LLM_TIMEOUT_MS` | Per-request LLM timeout in milliseconds | `30000` |
| `ASSISTANT_ENABLED` | Set to `false` to explicitly disable the assistant | enabled when `LLM_PROVIDER` + `LLM_MODEL` are set |

### MCP Server

| Variable | Description | Default |
|---|---|---|
| `MCP_AUTH_TOKEN` | Bearer token for HTTP transport — **required**, no default | — |
| `MCP_PORT` | Port the MCP server listens on inside Docker | `3001` |
| `MCP_TRANSPORT` | `http` (Docker default) or `stdio` (local CLI) | `http` |
| `MCP_ALLOWED_ORIGINS` | Comma-separated allowed `Origin` values for browser clients; empty = allow all | — |

**Example — Ollama (local):**
```env
LLM_PROVIDER=openai-compatible
LLM_MODEL=qwen3:8b
LLM_BASE_URL=http://localhost:11434
LLM_TIMEOUT_MS=60000
```

**Example — Anthropic:**
```env
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-6
LLM_API_KEY=sk-ant-...
```

**Local dev:** set in `server/.env`
**Docker:** set in `.env` at the project root (read by `docker-compose.yml`)

> When running in Docker, `MONGODB_URI` must use the service name: `mongodb://mongo:27017/wmata_dashboard`
> When running Ollama on the host machine with Docker, use `LLM_BASE_URL=http://host.docker.internal:11434`

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

| Service | Host port | Notes |
|---|---|---|
| Angular (Nginx) | 4200 | Also proxies `/api` and `/mcp` |
| Express API | — | Internal only (Docker network) |
| MCP Server | — | Internal only; access via nginx `/mcp` |

---

## Project Structure

```
wmta_dashboard/
├── docker-compose.yml
├── .env.example
├── mcp/
│   ├── Dockerfile
│   └── src/
│       ├── index.ts                  # Entry: MCP_TRANSPORT switch (http / stdio)
│       ├── server/
│       │   └── http.ts               # node:http server; auth, origin, rate-limit, /mcp
│       └── tools/
│           ├── index.ts              # registerAllTools() aggregator
│           ├── next_arrivals.ts      # Next-train predictions
│           ├── line_status.ts        # Rail incidents by line
│           ├── accessibility_status.ts # Elevator/escalator outages
│           ├── service_history.ts    # Historical adherence summaries
│           └── live_trains.ts        # Live train positions
├── server/
│   ├── Dockerfile
│   └── src/
│       ├── index.js                  # Express entry point, /health endpoint
│       ├── middleware/
│       │   └── wmata.js              # Axios client (base URL + API key)
│       ├── jobs/
│       │   └── poller.js             # node-cron 30 s job; adherence computation
│       ├── models/
│       │   ├── Incident.js
│       │   ├── TrainPosition.js
│       │   ├── ElevatorOutage.js
│       │   ├── AdherenceSnapshot.js
│       │   ├── BusPosition.js        # TTL: 24 hours
│       │   └── BusIncident.js        # TTL: 24 hours
│       ├── assistant/
│       │   ├── config.js             # LLM env var parsing; returns null if disabled
│       │   ├── agentLoop.js          # Tool-calling loop (MAX_ITER=5)
│       │   ├── tools.js              # TOOL_DEFINITIONS (8 tools incl. show_on_map)
│       │   ├── providers/
│       │   │   ├── anthropic.js
│       │   │   ├── openai.js
│       │   │   ├── gemini.js
│       │   │   ├── openai-compatible.js
│       │   │   └── index.js          # getAdapter(config) factory
│       │   └── toolHandlers/
│       │       ├── findStation.js
│       │       ├── getRailIncidents.js
│       │       ├── getTrainPositions.js
│       │       ├── getNextTrains.js
│       │       ├── getElevatorOutages.js
│       │       ├── getScheduleAdherence.js
│       │       └── getBusIncidents.js
│       └── routes/
│           ├── incidents.js          # /live + /history
│           ├── trains.js             # /live + /history
│           ├── elevators.js          # /live + /history
│           ├── predictions.js        # live station arrivals (no persistence)
│           ├── adherence.js          # /live + /history + /snapshot
│           ├── outages.js            # /live + /history (structured detail)
│           ├── map.js                # /api/map: trains + stations + incidents + polylines
│           ├── bus.js                # /map + /history/positions + /history/incidents
│           └── assistant.js          # GET /config + POST /chat (rate limited)
└── client/
    ├── Dockerfile
    ├── nginx.conf                    # SPA routing; 120 s proxy timeout; SSE headers
    ├── proxy.conf.json               # dev proxy: /api → :3000
    └── src/app/
        ├── app.routes.ts             # /rail (eager) + /bus (lazy-loaded chunk)
        ├── services/
        │   ├── wmata.service.ts      # all HTTP calls, relative /api base
        │   ├── assistant.service.ts  # panelOpen signal, getConfig(), chat()
        │   └── map-command.service.ts# Subject<MapAction>; pending bus action slot
        └── components/
            ├── nav-bar/              # RouterLink nav; Ask Dashboard toggle button
            ├── dashboard/            # /rail grid shell
            ├── map-panel/            # rail Leaflet map; focus_line / focus_station handler
            ├── incidents-panel/
            ├── train-positions-panel/
            ├── station-monitor/
            ├── adherence-panel/      # live + self-contained historical with chart
            ├── outage-panel/
            ├── historical-view/      # incidents & elevator history with replay
            ├── bus-map/              # /bus lazy chunk; focus_route handler
            └── assistant-panel/      # slide-out AI chat drawer
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

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness check |

### Rail

| Method | Path | Description |
|---|---|---|
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
| GET | `/api/outages` | Live elevator/escalator outages (structured detail) |
| GET | `/api/outages/history?from=&to=` | Historical outage records + per-day breakdown |
| GET | `/api/map` | Train positions + stations + incidents + line polylines |

### Bus

| Method | Path | Description |
|---|---|---|
| GET | `/api/bus/map` | Live positions, route list, stops, incidents, and route shapes for all active routes |
| GET | `/api/bus/history/positions?from=&to=` | Historical bus position snapshots (max 5000) |
| GET | `/api/bus/history/incidents?from=&to=` | Historical bus incident snapshots (max 5000) |

### Assistant

| Method | Path | Description |
|---|---|---|
| GET | `/api/assistant/config` | Returns `{ enabled, provider, model }` — no secrets |
| POST | `/api/assistant/chat` | `{ question, history }` → `{ reply, tools_used, map_actions }` (10 req/min per IP) |
