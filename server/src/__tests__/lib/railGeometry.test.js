'use strict';

const {
  buildRouteMaps,
  buildCircuitPositionMap,
  buildCircuitStationBracketMap,
  describeLocation,
} = require('../../lib/railGeometry');

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Two routes: track 1 and track 2 for line RD.
// Circuits: 0 (yard), 1 (station A01), 2 (mid), 3 (station A02), 4 (yard)
const standardRoutes = [
  {
    LineCode: 'RD',
    TrackNum: 1,
    TrackCircuits: [
      { SeqNum: 1, CircuitId: 100 },                       // before first station (yard)
      { SeqNum: 2, CircuitId: 101, StationCode: 'A01' },   // at Metro Center
      { SeqNum: 3, CircuitId: 102 },                       // between A01 and A02
      { SeqNum: 4, CircuitId: 103, StationCode: 'A02' },   // at Farragut North
      { SeqNum: 5, CircuitId: 104 },                       // after last station (yard)
    ],
  },
  {
    LineCode: 'RD',
    TrackNum: 2,
    TrackCircuits: [
      { SeqNum: 1, CircuitId: 200, StationCode: 'A02' },
      { SeqNum: 2, CircuitId: 201 },
      { SeqNum: 3, CircuitId: 202, StationCode: 'A01' },
    ],
  },
];

const stationMapObj = {
  A01: { Code: 'A01', Name: 'Metro Center',    Lat: 38.898, Lon: -77.028 },
  A02: { Code: 'A02', Name: 'Farragut North',  Lat: 38.903, Lon: -77.040 },
};

const stationsMap = new Map([
  ['A01', { Name: 'Metro Center',   Lat: 38.898, Lon: -77.028 }],
  ['A02', { Name: 'Farragut North', Lat: 38.903, Lon: -77.040 }],
]);

// ── buildRouteMaps ────────────────────────────────────────────────────────────

describe('buildRouteMaps', () => {
  test('maps circuit IDs to seq nums per line+track', () => {
    const { circuitMap, routeLen } = buildRouteMaps(standardRoutes);
    expect(circuitMap['RD'][1].get(101)).toBe(2);
    expect(circuitMap['RD'][1].get(103)).toBe(4);
    expect(circuitMap['RD'][2].get(200)).toBe(1);
    expect(circuitMap['RD'][2].get(202)).toBe(3);
  });

  test('records correct route lengths', () => {
    const { routeLen } = buildRouteMaps(standardRoutes);
    expect(routeLen['RD'][1]).toBe(5);
    expect(routeLen['RD'][2]).toBe(3);
  });

  test('skips routes missing LineCode or TrackNum', () => {
    const { circuitMap } = buildRouteMaps([{ TrackCircuits: [{ SeqNum: 1, CircuitId: 999 }] }]);
    expect(Object.keys(circuitMap)).toHaveLength(0);
  });
});

// ── buildCircuitPositionMap ───────────────────────────────────────────────────

describe('buildCircuitPositionMap', () => {
  const posMap = buildCircuitPositionMap(standardRoutes, stationMapObj);

  test('station circuit gets exact lat/lon', () => {
    expect(posMap.get(101)).toEqual({ lat: 38.898, lon: -77.028 });
    expect(posMap.get(103)).toEqual({ lat: 38.903, lon: -77.040 });
  });

  test('mid-segment circuit interpolates between bounding stations', () => {
    const mid = posMap.get(102);
    expect(mid).toBeDefined();
    // frac = (3-2)/(4-2) = 0.5
    expect(mid.lat).toBeCloseTo(38.898 + 0.5 * (38.903 - 38.898), 5);
    expect(mid.lon).toBeCloseTo(-77.028 + 0.5 * (-77.040 - -77.028), 5);
  });

  test('circuit before first station is omitted (yard)', () => {
    expect(posMap.get(100)).toBeUndefined();
  });

  test('circuit after last station is omitted (yard)', () => {
    expect(posMap.get(104)).toBeUndefined();
  });
});

// ── buildCircuitStationBracketMap ─────────────────────────────────────────────

describe('buildCircuitStationBracketMap', () => {
  const bracketMap = buildCircuitStationBracketMap(standardRoutes, stationsMap);

  test('circuit at a station returns atStation entry', () => {
    expect(bracketMap[101]).toEqual({ atStation: { code: 'A01', name: 'Metro Center' } });
    expect(bracketMap[103]).toEqual({ atStation: { code: 'A02', name: 'Farragut North' } });
  });

  test('circuit between two stations returns prevStation + nextStation', () => {
    expect(bracketMap[102]).toEqual({
      prevStation: { code: 'A01', name: 'Metro Center' },
      nextStation: { code: 'A02', name: 'Farragut North' },
    });
  });

  test('circuit before first station returns yard', () => {
    expect(bracketMap[100]).toEqual({ yard: true });
  });

  test('circuit after last station returns yard', () => {
    expect(bracketMap[104]).toEqual({ yard: true });
  });
});

// ── describeLocation ──────────────────────────────────────────────────────────

describe('describeLocation', () => {
  test('atStation entry', () => {
    expect(describeLocation({ atStation: { code: 'B01', name: 'Gallery Place' } }))
      .toBe('at Gallery Place (B01)');
  });

  test('between two stations entry', () => {
    expect(describeLocation({
      prevStation: { code: 'A02', name: 'Farragut North' },
      nextStation: { code: 'A01', name: 'Metro Center' },
    })).toBe('between Farragut North (A02) and Metro Center (A01)');
  });

  test('yard entry', () => {
    expect(describeLocation({ yard: true })).toBe('in yard');
  });

  test('null/undefined entry', () => {
    expect(describeLocation(null)).toBe('unknown');
    expect(describeLocation(undefined)).toBe('unknown');
  });

  test('unrecognised entry', () => {
    expect(describeLocation({})).toBe('unknown');
  });
});
