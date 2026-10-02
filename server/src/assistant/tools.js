'use strict';

const { findStation }          = require('./toolHandlers/findStation');
const { getRailIncidents }     = require('./toolHandlers/getRailIncidents');
const { getTrainPositions }    = require('./toolHandlers/getTrainPositions');
const { getNextTrains }        = require('./toolHandlers/getNextTrains');
const { getElevatorOutages }   = require('./toolHandlers/getElevatorOutages');
const { getScheduleAdherence } = require('./toolHandlers/getScheduleAdherence');
const { getBusIncidents }      = require('./toolHandlers/getBusIncidents');

const LINE_ENUM = { type: 'string', enum: ['RD', 'BL', 'OR', 'GR', 'YL', 'SV'] };

/**
 * TOOL_DEFINITIONS — each entry is passed to provider adapters as a ToolDefinition.
 * Descriptions are the only docs the model sees, so they are reviewed like code.
 * handler: null means the agent loop handles it specially (show_on_map).
 */
const TOOL_DEFINITIONS = [
  {
    name: 'find_station',
    description: 'Look up a WMATA rail station by name or partial name. Returns up to 3 matches with station code, full name, and served lines. Always call this before get_next_trains when you only have a name, not a code.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Station name or partial name, e.g. "Metro Center" or "Foggy"' },
      },
      required: ['query'],
    },
    handler: findStation,
  },
  {
    name: 'get_rail_incidents',
    description: 'Get rail service incidents. mode=live returns the current WMATA feed. mode=history queries the snapshot database and returns a count summary + top 5 (not raw records). Optional line filter. For history, provide ISO 8601 from/to.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['live', 'history'], description: 'live or history' },
        from: { type: 'string', format: 'date-time', description: 'ISO 8601 start; required for history' },
        to:   { type: 'string', format: 'date-time', description: 'ISO 8601 end; required for history' },
        line: { ...LINE_ENUM, description: 'Optional line filter' },
      },
      required: ['mode'],
    },
    handler: getRailIncidents,
  },
  {
    name: 'get_train_positions',
    description: 'Get current train positions and schedule adherence from the latest 30-second snapshot. Returns summary counts (on-time/minor/significant) and per-line breakdowns, plus the trains array. Optional line filter.',
    inputSchema: {
      type: 'object',
      properties: {
        line: { ...LINE_ENUM, description: 'Optional — omit for all lines' },
      },
    },
    handler: getTrainPositions,
  },
  {
    name: 'get_next_trains',
    description: 'Get live next-train arrival predictions for a station. Requires a WMATA station code (e.g. A01 for Metro Center). Use find_station first if you only have a name. Returns line, car count, destination, and minutes to arrival for each upcoming train.',
    inputSchema: {
      type: 'object',
      properties: {
        station_code: { type: 'string', description: 'WMATA station code, e.g. "A01". Use find_station first if you only have a name.' },
      },
      required: ['station_code'],
    },
    handler: getNextTrains,
  },
  {
    name: 'get_elevator_outages',
    description: 'Get elevator and escalator outage information. mode=live returns the current WMATA feed. mode=history queries the snapshot database, deduplicates by unit name, and flags ADA concern when both elevator and escalator are out at the same station. Returns up to 10 outages. Optional station_code filter.',
    inputSchema: {
      type: 'object',
      properties: {
        mode:         { type: 'string', enum: ['live', 'history'], description: 'live or history' },
        from:         { type: 'string', format: 'date-time' },
        to:           { type: 'string', format: 'date-time' },
        station_code: { type: 'string', description: 'Optional filter by WMATA station code' },
      },
      required: ['mode'],
    },
    handler: getElevatorOutages,
  },
  {
    name: 'get_schedule_adherence',
    description: 'Get schedule adherence data. mode=live returns the latest snapshot with on-time/minor/significant percentages. mode=history returns averaged trend over the range (not raw data). mode=snapshot returns the full snapshot closest to the at timestamp. Thresholds: on-time ≤10% deviation, minor ≤25%, significant >25% of ideal headway.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['live', 'history', 'snapshot'], description: 'live, history, or snapshot' },
        from: { type: 'string', format: 'date-time', description: 'Required for history' },
        to:   { type: 'string', format: 'date-time', description: 'Required for history' },
        at:   { type: 'string', format: 'date-time', description: 'Required for snapshot' },
        line: { ...LINE_ENUM, description: 'Optional line filter' },
      },
      required: ['mode'],
    },
    handler: getScheduleAdherence,
  },
  {
    name: 'get_bus_incidents',
    description: 'Get aggregated historical bus incident data for a date range. Returns total count, most affected route, most common type, average per day, type breakdown, and top 10 routes. Does not return a full incident list. Optional route_id filter (e.g. "16Y"). from and to are required.',
    inputSchema: {
      type: 'object',
      properties: {
        from:     { type: 'string', format: 'date-time', description: 'ISO 8601 start (required)' },
        to:       { type: 'string', format: 'date-time', description: 'ISO 8601 end (required)' },
        route_id: { type: 'string', description: 'Optional bus route ID filter, e.g. "16Y"' },
      },
      required: ['from', 'to'],
    },
    handler: getBusIncidents,
  },
  {
    name: 'show_on_map',
    description: 'Instruct the map panel to highlight a line, station, or bus route. Call this whenever your answer references a specific line, station, or route the operator might want to see. action=focus_line: highlight a rail line by code. action=focus_station: pan to a station by WMATA code. action=focus_route: highlight a bus route by route ID. Always returns { success: true } — its only effect is updating the map display.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['focus_station', 'focus_line', 'focus_route'] },
        target: { type: 'string', description: 'Station code (e.g. A01), WMATA line code (RD/BL/OR/GR/YL/SV), or bus route ID' },
      },
      required: ['action', 'target'],
    },
    handler: null, // intercepted by agentLoop before reaching dispatch
  },
];

module.exports = { TOOL_DEFINITIONS };
