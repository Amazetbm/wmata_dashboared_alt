'use strict';

jest.mock('../../models/BusPosition');
jest.mock('../../models/BusOccupancy');

const BusPosition  = require('../../models/BusPosition');
const BusOccupancy = require('../../models/BusOccupancy');
const { getBusPositions } = require('../../assistant/toolHandlers/getBusPositions');

const snapshotAt = new Date('2026-10-08T12:00:00Z');

function mockOccupancyDoc(value) {
  BusOccupancy.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
  });
}

beforeEach(() => {
  // Default: no occupancy doc
  mockOccupancyDoc(null);
});

// ── Helper: mock findOne for latest snapshot ───────────────────────────────────
function mockLatest(value) {
  BusPosition.findOne.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(value),
      }),
    }),
  });
}

// ── Tests: no snapshot ────────────────────────────────────────────────────────

test('returns empty summary shape when no snapshot and no route_id', async () => {
  mockLatest(null);

  const result = await getBusPositions();
  expect(result).toEqual({ snapshotAt: null, totalBuses: 0, routesShown: 0, routes: [] });
});

test('returns empty filtered shape when no snapshot and route_id provided', async () => {
  mockLatest(null);

  const result = await getBusPositions({ route_id: '16Y' });
  expect(result).toEqual({ snapshotAt: null, route: '16Y', count: 0, buses: [] });
});

// ── Tests: no route_id (system-wide summary) ──────────────────────────────────

describe('without route_id', () => {
  beforeEach(() => {
    mockLatest({ snapshotAt });

    BusPosition.aggregate.mockResolvedValue([
      { route: '16Y', count: 12, headsigns: ['Farragut Square'] },
      { route: '30N', count: 8,  headsigns: ['Friendship Heights'] },
    ]);

    BusPosition.countDocuments.mockResolvedValue(20);
  });

  test('returns totalBuses and routes summary', async () => {
    const result = await getBusPositions();

    expect(result.snapshotAt).toEqual(snapshotAt);
    expect(result.totalBuses).toBe(20);
    expect(result.routesShown).toBe(2);
    expect(result.routes).toHaveLength(2);
    expect(result.routes[0].route).toBe('16Y');
    expect(result.routes[0].count).toBe(12);
  });

  test('does not include buses array', async () => {
    const result = await getBusPositions();
    expect(result).not.toHaveProperty('buses');
  });

  test('does not include note when fewer than 20 routes returned', async () => {
    const result = await getBusPositions();
    expect(result).not.toHaveProperty('note');
  });

  test('includes note when exactly 20 routes returned', async () => {
    const twentyRoutes = Array.from({ length: 20 }, (_, i) => ({
      route: `R${i}`, count: i + 1, headsigns: [],
    }));
    BusPosition.aggregate.mockResolvedValue(twentyRoutes);

    const result = await getBusPositions();
    expect(result.note).toMatch(/Top 20/);
  });
});

// ── Tests: with route_id ──────────────────────────────────────────────────────

describe('with route_id', () => {
  const busDocs = [
    {
      VehicleID: 'V1', RouteID: '16Y', DirectionText: 'NORTH',
      TripHeadsign: 'Farragut Square', Lat: 38.9, Lon: -77.0, Deviation: 2,
    },
    {
      VehicleID: 'V2', RouteID: '16Y', DirectionText: 'SOUTH',
      TripHeadsign: 'Pentagon', Lat: 38.85, Lon: -77.05, Deviation: -1,
    },
  ];

  beforeEach(() => {
    mockLatest({ snapshotAt });

    BusPosition.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(busDocs),
        }),
      }),
    });
  });

  test('returns buses array with compact records', async () => {
    const result = await getBusPositions({ route_id: '16y' });

    expect(result.route).toBe('16Y');
    expect(result.count).toBe(2);
    expect(result.buses).toHaveLength(2);

    const b = result.buses[0];
    expect(b.vehicleId).toBe('V1');
    expect(b.route).toBe('16Y');
    expect(b.direction).toBe('NORTH');
    expect(b.headsign).toBe('Farragut Square');
    expect(b.lat).toBe(38.9);
    expect(b.lon).toBe(-77.0);
    expect(b.deviation).toBe(2);
  });

  test('upcases route_id before matching', async () => {
    await getBusPositions({ route_id: '16y' });
    // The find call should have been given RouteID: '16Y'
    expect(BusPosition.find).toHaveBeenCalledWith(
      expect.objectContaining({ RouteID: '16Y' })
    );
  });

  test('does not include routes summary array', async () => {
    const result = await getBusPositions({ route_id: '16Y' });
    expect(result).not.toHaveProperty('routes');
    expect(result).not.toHaveProperty('totalBuses');
  });

  test('returns empty buses array when route has no buses in snapshot', async () => {
    BusPosition.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      }),
    });

    const result = await getBusPositions({ route_id: '99X' });
    expect(result.count).toBe(0);
    expect(result.buses).toEqual([]);
  });
});

// ── Tests: bus occupancy enrichment (filtered mode) ───────────────────────────

describe('occupancy enrichment — filtered mode', () => {
  const busDocs = [
    {
      VehicleID: 'V1', RouteID: '16Y', DirectionText: 'NORTH',
      TripHeadsign: 'Farragut Square', Lat: 38.9, Lon: -77.0, Deviation: 2,
    },
  ];

  beforeEach(() => {
    mockLatest({ snapshotAt });
    BusPosition.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(busDocs),
        }),
      }),
    });
  });

  test('occupancy: null for all buses when flag off (default)', async () => {
    const result = await getBusPositions({ route_id: '16Y' });
    // GTFS_BUS_OCCUPANCY not set → enrichWithOccupancy returns original array unchanged
    // The handler always adds occupancy: null at minimum
    expect(result.buses[0]).toHaveProperty('occupancy');
  });

  test('enriches buses with bus-band labels when flag on and doc is fresh', async () => {
    const origEnv = process.env.GTFS_BUS_OCCUPANCY;
    process.env.GTFS_BUS_OCCUPANCY = 'true';
    jest.resetModules();
    jest.mock('../../models/BusPosition');
    jest.mock('../../models/BusOccupancy');
    const BP2 = require('../../models/BusPosition');
    const BO2 = require('../../models/BusOccupancy');
    const { getBusPositions: gbp2 } = require('../../assistant/toolHandlers/getBusPositions');

    BP2.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ snapshotAt }),
        }),
      }),
    });
    BP2.find.mockReturnValue({
      limit: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(busDocs),
        }),
      }),
    });
    BO2.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          feedTimestamp: new Date(), // fresh
          vehicles: [{ vehicleId: 'V1', occupancyStatus: 2 }],
        }),
      }),
    });

    const result = await gbp2({ route_id: '16Y' });
    expect(result.buses[0].occupancy).toMatchObject({ status: 2 });
    // Bus-specific label (25–49%)
    expect(result.buses[0].occupancy.label).toMatch(/25–49%/);

    process.env.GTFS_BUS_OCCUPANCY = origEnv ?? '';
  });
});

// ── Tests: bus occupancy crowding (unfiltered mode) ───────────────────────────

describe('occupancy crowding — unfiltered mode', () => {
  beforeEach(() => {
    mockLatest({ snapshotAt });
    BusPosition.aggregate.mockResolvedValue([
      { route: '16Y', count: 5, headsigns: ['Farragut Square'] },
    ]);
    BusPosition.countDocuments.mockResolvedValue(5);
  });

  test('no crowding key when flag off (default)', async () => {
    const result = await getBusPositions();
    expect(result.routes[0]).not.toHaveProperty('crowding');
  });

  test('routes include crowding breakdown when flag on and feed is fresh', async () => {
    const origEnv = process.env.GTFS_BUS_OCCUPANCY;
    process.env.GTFS_BUS_OCCUPANCY = 'true';
    jest.resetModules();
    jest.mock('../../models/BusPosition');
    jest.mock('../../models/BusOccupancy');
    const BP2 = require('../../models/BusPosition');
    const BO2 = require('../../models/BusOccupancy');
    const { getBusPositions: gbp2 } = require('../../assistant/toolHandlers/getBusPositions');

    BP2.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ snapshotAt }),
        }),
      }),
    });
    BP2.aggregate.mockResolvedValue([
      { route: '16Y', count: 3, headsigns: ['Farragut Square'] },
    ]);
    BP2.countDocuments.mockResolvedValue(3);
    BP2.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { VehicleID: 'V1', RouteID: '16Y' },
          { VehicleID: 'V2', RouteID: '16Y' },
          { VehicleID: 'V3', RouteID: '16Y' },
        ]),
      }),
    });
    BO2.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          feedTimestamp: new Date(), // fresh
          vehicles: [
            { vehicleId: 'V1', occupancyStatus: 1 }, // many
            { vehicleId: 'V2', occupancyStatus: 5 }, // full
            // V3 not in feed → unknown
          ],
        }),
      }),
    });

    const result = await gbp2();
    const route = result.routes.find(r => r.route === '16Y');
    expect(route.crowding).toMatchObject({ many: 1, few: 0, full: 1, unknown: 1 });

    process.env.GTFS_BUS_OCCUPANCY = origEnv ?? '';
  });
});
