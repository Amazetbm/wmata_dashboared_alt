import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { OutagePanelComponent } from './outage-panel.component';
import { WmataService } from '../../services/wmata.service';
import { makeOutage } from '../../../testing/api-fixtures';

vi.mock('chart.js', () => ({
  Chart: class MockChart {
    static register = vi.fn();
    data = { labels: [], datasets: [{ data: [] }, { data: [] }] };
    update = vi.fn();
    destroy = vi.fn();
    constructor(_ctx: any, _config: any) {}
  },
  registerables: [],
}));

describe('OutagePanelComponent', () => {
  let fixture: ComponentFixture<OutagePanelComponent>;
  let component: OutagePanelComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

    await TestBed.configureTestingModule({
      imports: [OutagePanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), WmataService],
    }).compileComponents();

    fixture = TestBed.createComponent(OutagePanelComponent);
    component = fixture.componentInstance;
    fixture.autoDetectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
  });

  it('renders outage rows on initial load', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/outages');
    req.flush([makeOutage(), makeOutage({ UnitName: 'A01X02', UnitType: 'ESCALATOR' })]);
    await vi.advanceTimersByTimeAsync(0);

    expect(component.outages().length).toBe(2);
  });

  it('re-renders on 30 s refresh', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne('/api/outages');
    req1.flush([makeOutage()]);
    await vi.advanceTimersByTimeAsync(0);

    expect(component.outages().length).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    const req2 = httpMock.expectOne('/api/outages');
    req2.flush([makeOutage(), makeOutage({ UnitName: 'B01X01' })]);
    await vi.advanceTimersByTimeAsync(0);

    expect(component.outages().length).toBe(2);
  });

  it('sets error signal on HTTP error', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/outages');
    req.flush({ error: 'fail' }, { status: 500, statusText: 'Error' });
    await vi.advanceTimersByTimeAsync(0);

    expect(component.error()).toBeTruthy();
  });

  it('empty state: zero outages', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/outages');
    req.flush([]);
    await vi.advanceTimersByTimeAsync(0);

    expect(component.outages().length).toBe(0);
  });

  it('ELEVATOR type filter shows only elevators', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/outages');
    req.flush([
      makeOutage({ UnitType: 'ELEVATOR' }),
      makeOutage({ UnitName: 'A01X02', UnitType: 'ESCALATOR' }),
    ]);
    await vi.advanceTimersByTimeAsync(0);

    component.typeFilter = 'ELEVATOR';
    const displayed = component.liveDisplayed;
    expect(displayed.every(o => o.UnitType === 'ELEVATOR')).toBe(true);
    expect(displayed.length).toBe(1);
  });

  it('ESCALATOR type filter shows only escalators', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/outages');
    req.flush([
      makeOutage({ UnitType: 'ELEVATOR' }),
      makeOutage({ UnitName: 'A01X02', UnitType: 'ESCALATOR' }),
    ]);
    await vi.advanceTimersByTimeAsync(0);

    component.typeFilter = 'ESCALATOR';
    const displayed = component.liveDisplayed;
    expect(displayed.every(o => o.UnitType === 'ESCALATOR')).toBe(true);
  });

  it('enrich(): duration > 72h → durationClass red', () => {
    const now = Date.now();
    const outTime = new Date(now - 73 * 3600_000).toISOString();
    const enriched = (component as any).enrich(makeOutage({ TimeOutOfService: outTime }), false);
    expect(enriched.durationClass).toBe('red');
  });

  it('enrich(): duration > 24h → durationClass amber', () => {
    const now = Date.now();
    const outTime = new Date(now - 25 * 3600_000).toISOString();
    const enriched = (component as any).enrich(makeOutage({ TimeOutOfService: outTime }), false);
    expect(enriched.durationClass).toBe('amber');
  });

  it('enrich(): duration < 24h → durationClass normal', () => {
    const now = Date.now();
    const outTime = new Date(now - 1 * 3600_000).toISOString();
    const enriched = (component as any).enrich(makeOutage({ TimeOutOfService: outTime }), false);
    expect(enriched.durationClass).toBe('normal');
  });

  it('switching to historical view calls getOutageHistory', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne('/api/outages');
    req1.flush([]);
    await vi.advanceTimersByTimeAsync(0);

    component.switchView('historical');

    const histReq = httpMock.expectOne(r => r.url === '/api/outages/history');
    histReq.flush({ outages: [], chartData: [] });
    await vi.advanceTimersByTimeAsync(0);

    expect(component.view).toBe('historical');
  });
});
