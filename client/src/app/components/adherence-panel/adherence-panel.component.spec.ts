import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AdherencePanelComponent } from './adherence-panel.component';
import { WmataService } from '../../services/wmata.service';
import { makeAdherenceRecord } from '../../../testing/api-fixtures';

vi.mock('chart.js', () => ({
  Chart: class MockChart {
    static register = vi.fn();
    data = { labels: [], datasets: [{ data: [] }, { data: [] }, { data: [] }] };
    update = vi.fn();
    destroy = vi.fn();
    constructor(_ctx: any, _config: any) {}
  },
  registerables: [],
}));

function makeAdherenceResponse(trains: any[] = [], overrides: any = {}) {
  return {
    trains,
    summary: { total: trains.length, onTime: trains.length, minor: 0, significant: 0 },
    snapshotAt: new Date().toISOString(),
    lineSummaries: [],
    ...overrides,
  };
}

describe('AdherencePanelComponent', () => {
  let fixture: ComponentFixture<AdherencePanelComponent>;
  let component: AdherencePanelComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

    await TestBed.configureTestingModule({
      imports: [AdherencePanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), WmataService],
    }).compileComponents();

    fixture = TestBed.createComponent(AdherencePanelComponent);
    component = fixture.componentInstance;
    fixture.autoDetectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
  });

  it('renders train rows on initial load', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/adherence/live');
    req.flush(makeAdherenceResponse([makeAdherenceRecord(), makeAdherenceRecord({ trainId: 'T002' })]));
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('re-renders on 30 s refresh', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne('/api/adherence/live');
    req1.flush(makeAdherenceResponse([makeAdherenceRecord()]));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(30_000);
    const req2 = httpMock.expectOne('/api/adherence/live');
    req2.flush(makeAdherenceResponse([makeAdherenceRecord(), makeAdherenceRecord({ trainId: 'T002' })]));
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('sets error signal on HTTP error', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/adherence/live');
    req.flush({ error: 'fail' }, { status: 500, statusText: 'Error' });
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelector('.error')).toBeTruthy();
  });

  it('empty state: no trains', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/adherence/live');
    req.flush(makeAdherenceResponse([]));
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(0);
  });

  it('line filter and applyFilter updates filtered', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne('/api/adherence/live');
    req1.flush(makeAdherenceResponse([
      makeAdherenceRecord({ lineCode: 'RD' }),
      makeAdherenceRecord({ trainId: 'T002', lineCode: 'BL' }),
    ]));
    await vi.advanceTimersByTimeAsync(0);

    component.selectedLine = 'RD';
    component.applyFilter();
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('switching to historical mode fetches getHistoricalAdherence', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne('/api/adherence/live');
    req1.flush(makeAdherenceResponse([]));
    await vi.advanceTimersByTimeAsync(0);

    component.switchView('historical');

    const histReq = httpMock.expectOne(r => r.url === '/api/adherence/history');
    histReq.flush([]);
    await vi.advanceTimersByTimeAsync(0);

    expect(component.view).toBe('historical');
    expect(fixture.nativeElement.querySelector('.empty')).toBeTruthy();
  });

  it('line filter persists as query param when switching to historical', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne('/api/adherence/live');
    req1.flush(makeAdherenceResponse([]));
    await vi.advanceTimersByTimeAsync(0);

    component.selectedLine = 'BL';
    component.switchView('historical');

    const histReq = httpMock.expectOne(r =>
      r.url === '/api/adherence/history' && r.params.get('line') === 'BL'
    );
    histReq.flush([]);
    await vi.advanceTimersByTimeAsync(0);

    expect(component.selectedLine).toBe('BL');
  });

  it('3h preset sets correct from/to range', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne('/api/adherence/live');
    req1.flush(makeAdherenceResponse([]));
    await vi.advanceTimersByTimeAsync(0);

    // Switch to historical first so hasFetched is true for next preset change
    component.switchView('historical');
    const histReq1 = httpMock.expectOne(r => r.url === '/api/adherence/history');
    histReq1.flush([]);
    await vi.advanceTimersByTimeAsync(0);

    component.preset = '3h';
    component.onPresetChange();

    const histReq2 = httpMock.expectOne(r => r.url === '/api/adherence/history');
    const fromParam = new Date(histReq2.request.params.get('from')!);
    const toParam = new Date(histReq2.request.params.get('to')!);
    const diffMs = toParam.getTime() - fromParam.getTime();
    expect(diffMs).toBeCloseTo(3 * 3600_000, -3);
    histReq2.flush([]);
  });

  it('custom range does not fetch unless both dates present', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne('/api/adherence/live');
    req1.flush(makeAdherenceResponse([]));
    await vi.advanceTimersByTimeAsync(0);

    component.preset = 'custom';
    component.from = '';
    component.to = '';
    component.fetchHistory();

    httpMock.expectNone('/api/adherence/history');
  });
});
