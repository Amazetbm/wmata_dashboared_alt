import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { WmataService } from './wmata.service';

describe('WmataService', () => {
  let service: WmataService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), WmataService],
    });
    service = TestBed.inject(WmataService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  const cases: Array<[string, () => any, string, Record<string, string>]> = [
    ['getLiveIncidents()', () => service.getLiveIncidents(), '/api/incidents/live', {}],
    ['getLiveTrains()', () => service.getLiveTrains(), '/api/trains/live', {}],
    ['getLocatedTrains() no line', () => service.getLocatedTrains(), '/api/trains/located', {}],
    ['getLocatedTrains(RD)', () => service.getLocatedTrains('RD'), '/api/trains/located', { line: 'RD' }],
    ['getLiveElevators()', () => service.getLiveElevators(), '/api/elevators/live', {}],
    ['getLiveAdherence()', () => service.getLiveAdherence(), '/api/adherence/live', {}],
    ['getLiveOutages()', () => service.getLiveOutages(), '/api/outages', {}],
    ['getMapData()', () => service.getMapData(), '/api/map', {}],
    ['getBusMapData()', () => service.getBusMapData(), '/api/bus/map', {}],
    ['getPredictions(A01)', () => service.getPredictions('A01'), '/api/predictions/A01', {}],
  ];

  cases.forEach(([name, call, url, expectedParams]) => {
    it(`${name} → GET ${url}`, () => {
      call().subscribe();
      const req = httpMock.expectOne(r => r.url === url);
      expect(req.request.method).toBe('GET');
      for (const [key, val] of Object.entries(expectedParams)) {
        expect(req.request.params.get(key)).toBe(val);
      }
      req.flush({});
    });
  });

  it('getHistoricalIncidents sends from/to params', () => {
    service.getHistoricalIncidents('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z').subscribe();
    const req = httpMock.expectOne(r => r.url === '/api/incidents/history');
    expect(req.request.params.get('from')).toBe('2026-01-01T00:00:00.000Z');
    expect(req.request.params.get('to')).toBe('2026-01-02T00:00:00.000Z');
    req.flush([]);
  });

  it('getHistoricalAdherence with line sends from/to/line params', () => {
    service.getHistoricalAdherence('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', 'BL').subscribe();
    const req = httpMock.expectOne(r => r.url === '/api/adherence/history');
    expect(req.request.params.get('from')).toBe('2026-01-01T00:00:00.000Z');
    expect(req.request.params.get('to')).toBe('2026-01-02T00:00:00.000Z');
    expect(req.request.params.get('line')).toBe('BL');
    req.flush([]);
  });

  it('getHistoricalAdherence without line omits line param', () => {
    service.getHistoricalAdherence('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z').subscribe();
    const req = httpMock.expectOne(r => r.url === '/api/adherence/history');
    expect(req.request.params.has('line')).toBe(false);
    req.flush([]);
  });

  it('getAdherenceSnapshot sends at param', () => {
    service.getAdherenceSnapshot('2026-01-01T12:00:00.000Z').subscribe();
    const req = httpMock.expectOne(r => r.url === '/api/adherence/snapshot');
    expect(req.request.params.get('at')).toBe('2026-01-01T12:00:00.000Z');
    req.flush({});
  });

  it('getOutageHistory sends from/to params', () => {
    service.getOutageHistory('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z').subscribe();
    const req = httpMock.expectOne(r => r.url === '/api/outages/history');
    expect(req.request.params.get('from')).toBe('2026-01-01T00:00:00.000Z');
    expect(req.request.params.get('to')).toBe('2026-01-02T00:00:00.000Z');
    req.flush({});
  });

  it('getHistoricalElevators sends from/to params', () => {
    service.getHistoricalElevators('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z').subscribe();
    const req = httpMock.expectOne(r => r.url === '/api/elevators/history');
    expect(req.request.params.get('from')).toBe('2026-01-01T00:00:00.000Z');
    req.flush([]);
  });

  it('getBusIncidentHistory sends all params', () => {
    service.getBusIncidentHistory('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '10A').subscribe();
    const req = httpMock.expectOne(r => r.url === '/api/bus/incidents/history');
    expect(req.request.params.get('startTime')).toBe('2026-01-01T00:00:00.000Z');
    expect(req.request.params.get('routeId')).toBe('10A');
    req.flush([]);
  });
});
