'use strict';

jest.mock('../../models/BusPosition');

const BusPosition = require('../../models/BusPosition');
const { getBusPositions } = require('../../assistant/toolHandlers/getBusPositions');

const snapshotAt = new Date('2026-10-08T12:00:00Z');

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

test('returns empty result when no snapshot exists', async () => {
  mockLatest(null);

  const result = await getBusPositions();
  expect(result).toEqual({ snapshotAt: null, count: 0, routes: [], buses: [] });
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
