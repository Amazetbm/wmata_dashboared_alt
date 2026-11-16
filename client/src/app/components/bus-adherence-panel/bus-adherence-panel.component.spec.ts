import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { BusAdherencePanelComponent } from './bus-adherence-panel.component';

vi.mock('chart.js', () => ({
  Chart: class MockChart {
    static register = vi.fn();
    destroy = vi.fn();
    constructor(_ctx: any, _config: any) {}
  },
  registerables: [],
}));

function makeLiveResponse(overrides: any = {}) {
  return {
    snapshotAt: new Date().toISOString(),
    coverageRate: 0.82,
    degraded: false,
    summary: { total: 10, early: 1, onTime: 7, minor: 1, significant: 1, noPrediction: 2, canceled: 0, unscheduled: 0, added: 0 },
    routeSummaries: [
      { routeId: 'A11', total: 5, early: 0, onTime: 4, minor: 1, significant: 0, noPrediction: 1 },
    ],
    buses: [
      { vehicleId: 'BUS001', routeId: 'A11', tripId: 'trip1', delaySeconds: 500, delayLabel: 'minor' },
      { vehicleId: 'BUS002', routeId: 'A11', tripId: 'trip2', delaySeconds: 60, delayLabel: 'onTime' },
    ],
    ...overrides,
  };
}

describe('BusAdherencePanelComponent', () => {
  let fixture: ComponentFixture<BusAdherencePanelComponent>;
  let component: BusAdherencePanelComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

    await TestBed.configureTestingModule({
      imports: [BusAdherencePanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(BusAdherencePanelComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.autoDetectChanges();
  });

  afterEach(async () => {
    httpMock.verify();
    vi.useRealTimers();
  });

  it('creates the component', async () => {
    await vi.advanceTimersByTimeAsync(0); // let timer(0, 30_000) fire
    httpMock.expectOne(r => r.url.includes('/api/bus/adherence/schedule/live')).flush(makeLiveResponse());
    expect(component).toBeTruthy();
  });

  it('shows loading state initially', async () => {
    await vi.advanceTimersByTimeAsync(0); // let timer(0, 30_000) fire → HTTP call made but not yet flushed
    const req = httpMock.expectOne(r => r.url.includes('/api/bus/adherence/schedule/live'));
    expect(component.loading()).toBe(true);
    req.flush(makeLiveResponse());
  });

  it('populates buses and summary on successful live response', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne(r => r.url.includes('/api/bus/adherence/schedule/live'));
    req.flush(makeLiveResponse());
    await vi.advanceTimersByTimeAsync(0);

    expect(component.loading()).toBe(false);
    expect(component.error()).toBe('');
    expect(component.buses()).toHaveLength(2);
    expect(component.summary().total).toBe(10);
    expect(component.coverageRate()).toBeCloseTo(0.82);
    expect(component.degraded()).toBe(false);
  });

  it('shows noPredictionCount badge when noPrediction > 0', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne(r => r.url.includes('/api/bus/adherence/schedule/live'));
    req.flush(makeLiveResponse({ summary: { total: 5, early: 0, onTime: 3, minor: 1, significant: 1, noPrediction: 3, canceled: 0, unscheduled: 0, added: 0 } }));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    expect(component.noPredictionCount()).toBe(3);
    const badge = fixture.nativeElement.querySelector('.alert-info');
    expect(badge?.textContent).toContain('3');
  });

  it('shows degraded notice when degraded=true', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne(r => r.url.includes('/api/bus/adherence/schedule/live'));
    req.flush(makeLiveResponse({ degraded: true, coverageRate: 0.55 }));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    const notice = fixture.nativeElement.querySelector('.alert-warning');
    expect(notice).not.toBeNull();
  });

  it('shows degraded notice when coverageRate < 0.60', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne(r => r.url.includes('/api/bus/adherence/schedule/live'));
    req.flush(makeLiveResponse({ degraded: false, coverageRate: 0.55 }));
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();

    const notice = fixture.nativeElement.querySelector('.alert-warning');
    expect(notice).not.toBeNull();
  });

  it('sorts buses by delaySeconds descending', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne(r => r.url.includes('/api/bus/adherence/schedule/live'));
    req.flush(makeLiveResponse());
    await vi.advanceTimersByTimeAsync(0);

    const delays = component.buses().map(b => b.delaySeconds ?? 0);
    expect(delays[0]).toBeGreaterThanOrEqual(delays[1]);
  });

  it('polls every 30 seconds', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne(r => r.url.includes('/api/bus/adherence/schedule/live'));
    req1.flush(makeLiveResponse());
    await vi.advanceTimersByTimeAsync(0);

    // Advance 30s — should trigger another poll
    await vi.advanceTimersByTimeAsync(30_000);
    const req2 = httpMock.expectOne(r => r.url.includes('/api/bus/adherence/schedule/live'));
    req2.flush(makeLiveResponse());
    await vi.advanceTimersByTimeAsync(0);

    expect(component.buses()).toHaveLength(2);
  });

  it('computes onTimePct correctly', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne(r => r.url.includes('/api/bus/adherence/schedule/live'));
    req.flush(makeLiveResponse());
    await vi.advanceTimersByTimeAsync(0);

    // early(1)+onTime(7)+minor(1)+significant(1) = 10; onTime(7)/10 = 70%
    expect(component.onTimePct()).toBe(70);
  });

  it('formatDelay returns correct string for positive delay', () => {
    expect(component.formatDelay(90)).toBe('+1m 30s');
  });

  it('formatDelay returns correct string for negative delay (early)', () => {
    expect(component.formatDelay(-130)).toBe('−2m 10s');
  });

  it('formatDelay returns — for null', () => {
    expect(component.formatDelay(null)).toBe('—');
  });
});
