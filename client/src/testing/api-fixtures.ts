/** Builder functions returning typed partial objects matching component expectations. */

export function makeIncident(overrides: Partial<{
  IncidentType: string;
  Description: string;
  LinesAffected: string;
  PassengerDelay: number;
  DateUpdated: string;
}> = {}) {
  return {
    IncidentType: 'Delay',
    Description: 'Red Line delays near Metro Center',
    LinesAffected: 'RD;',
    PassengerDelay: 5,
    DateUpdated: new Date().toISOString(),
    ...overrides,
  };
}

export function makeTrain(overrides: Partial<{
  trainId: string;
  trainNumber: string;
  lineCode: string;
  directionNum: number;
  circuitId: number;
  currentSeq: number;
  expectedSeq: number;
  deviation: number;
  status: string;
  carCount: number;
  occupancy: any;
  lat: number;
  lon: number;
}> = {}) {
  return {
    trainId: 'T001',
    trainNumber: '101',
    lineCode: 'RD',
    directionNum: 1,
    circuitId: 1234,
    currentSeq: 10,
    expectedSeq: 10,
    deviation: 0,
    status: 'on-time',
    carCount: 6,
    occupancy: null,
    lat: 38.8971,
    lon: -77.0366,
    ...overrides,
  };
}

export function makeOutage(overrides: Partial<{
  UnitName: string;
  UnitType: string;
  StationCode: string;
  StationName: string;
  LocationDescription: string;
  SymptomDescription: string;
  TimeOutOfService: string;
  EstimatedReturnToService: string | null;
  DateUpdated: string;
}> = {}) {
  return {
    UnitName: 'A01X01',
    UnitType: 'ELEVATOR',
    StationCode: 'A01',
    StationName: 'Metro Center',
    LocationDescription: 'Platform to Mezzanine',
    SymptomDescription: 'Under maintenance',
    TimeOutOfService: new Date(Date.now() - 2 * 3600_000).toISOString(),
    EstimatedReturnToService: null,
    DateUpdated: new Date().toISOString(),
    ...overrides,
  };
}

export function makePrediction(overrides: Partial<{
  Line: string;
  DestinationName: string;
  Car: string;
  Min: string;
}> = {}) {
  return {
    Line: 'RD',
    DestinationName: 'Glenmont',
    Car: '6',
    Min: '3',
    ...overrides,
  };
}

export function makeAdherenceRecord(overrides: Partial<{
  trainId: string;
  trainNumber: string;
  lineCode: string;
  directionNum: number;
  circuitId: number;
  currentSeq: number;
  expectedSeq: number;
  deviation: number;
  status: string;
  carCount: number;
}> = {}) {
  return {
    trainId: 'T001',
    trainNumber: '101',
    lineCode: 'RD',
    directionNum: 1,
    circuitId: 1234,
    currentSeq: 10,
    expectedSeq: 10,
    deviation: 0,
    status: 'on-time',
    carCount: 6,
    ...overrides,
  };
}

export function makeHistoricalRecord(overrides: Partial<{
  snapshotAt: string;
  IncidentType: string;
  Description: string;
  LinesAffected: string;
}> = {}) {
  return {
    snapshotAt: new Date().toISOString(),
    IncidentType: 'Delay',
    Description: 'Test incident',
    LinesAffected: 'RD;',
    ...overrides,
  };
}
