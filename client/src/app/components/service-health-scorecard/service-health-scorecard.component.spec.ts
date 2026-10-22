import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ServiceHealthScorecardComponent } from './service-health-scorecard.component';
import { WmataService } from '../../services/wmata.service';
import { makeIncident, makeOutage } from '../../../testing/api-fixtures';

function makeAdherenceResponse(lineSummaries: any[] = []) {
  return { trains: [], summary: { total: 0, onTime: 0, minor: 0, significant: 0 }, lineSummaries };
}

function flushThreeRequests(httpMock: HttpTestingController, adherence: any, incidents: any, outages: any[]) {
  httpMock.expectOne('/api/adherence/live').flush(adherence);
  httpMock.expectOne('/api/incidents/live').flush(incidents);
  httpMock.expectOne('/api/outages').flush(outages);
}

function findLineCard(nativeEl: Element, lineName: string): HTMLElement | undefined {
  const cards = Array.from(nativeEl.querySelectorAll('.line-card')) as HTMLElement[];
  return cards.find(c => c.querySelector('.line-name')?.textContent?.includes(lineName));
}

describe('ServiceHealthScorecardComponent', () => {
  let fixture: ComponentFixture<ServiceHealthScorecardComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

    await TestBed.configureTestingModule({
      imports: [ServiceHealthScorecardComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), WmataService],
    }).compileComponents();

    fixture = TestBed.createComponent(ServiceHealthScorecardComponent);
    fixture.autoDetectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
  });

  it('initial load dispatches forkJoin of three requests and builds scores', async () => {
    await vi.advanceTimersByTimeAsync(0);
    flushThreeRequests(httpMock,
      makeAdherenceResponse([{ lineCode: 'RD', total: 10, onTime: 9, minor: 1, significant: 0 }]),
      { Incidents: [] },
      []
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelectorAll('.line-card').length).toBe(6);
    const rdCard = findLineCard(fixture.nativeElement, 'Red')!;
    expect(rdCard.querySelector('.adherence-pct')?.textContent?.trim()).toBe('90%');
  });

  it('counts incidents by parsing LinesAffected', async () => {
    await vi.advanceTimersByTimeAsync(0);
    flushThreeRequests(httpMock,
      makeAdherenceResponse(),
      { Incidents: [
        makeIncident({ LinesAffected: 'RD;BL;' }),
        makeIncident({ LinesAffected: 'RD;' }),
        makeIncident({ LinesAffected: 'GR;' }),
      ]},
      []
    );
    await vi.advanceTimersByTimeAsync(0);

    const rdCard = findLineCard(fixture.nativeElement, 'Red')!;
    const blCard = findLineCard(fixture.nativeElement, 'Blue')!;
    const grCard = findLineCard(fixture.nativeElement, 'Green')!;
    const incText = (card: HTMLElement) =>
      (Array.from(card.querySelectorAll('.metric')) as HTMLElement[])
        .find(m => m.textContent?.includes('inc'))?.textContent?.trim();
    expect(incText(rdCard)).toBe('2 inc');
    expect(incText(blCard)).toBe('1 inc');
    expect(incText(grCard)).toBe('1 inc');
  });

  it('computeStatus: < 70% adherence → degraded', async () => {
    await vi.advanceTimersByTimeAsync(0);
    flushThreeRequests(httpMock,
      makeAdherenceResponse([{ lineCode: 'RD', total: 10, onTime: 6, minor: 2, significant: 2 }]),
      { Incidents: [] },
      []
    );
    await vi.advanceTimersByTimeAsync(0);

    const rdCard = findLineCard(fixture.nativeElement, 'Red')!;
    expect(rdCard.classList.contains('status-degraded')).toBe(true);
  });

  it('computeStatus: outage count >= 3 → degraded (when adherence good)', async () => {
    await vi.advanceTimersByTimeAsync(0);
    // A01, A02, A03 = Red line stations
    flushThreeRequests(httpMock,
      makeAdherenceResponse([{ lineCode: 'RD', total: 10, onTime: 10, minor: 0, significant: 0 }]),
      { Incidents: [] },
      [makeOutage({ StationCode: 'A01' }), makeOutage({ StationCode: 'A02' }), makeOutage({ StationCode: 'A03' })]
    );
    await vi.advanceTimersByTimeAsync(0);

    const rdCard = findLineCard(fixture.nativeElement, 'Red')!;
    expect(rdCard.classList.contains('status-degraded')).toBe(true);
  });

  it('sets error signal on forkJoin failure', async () => {
    await vi.advanceTimersByTimeAsync(0);
    httpMock.expectOne('/api/adherence/live').flush({ error: 'fail' }, { status: 500, statusText: 'Error' });
    httpMock.match('/api/incidents/live');
    httpMock.match('/api/outages');
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelector('.error')).toBeTruthy();
  });

  it('refreshes on 30 s timer', async () => {
    await vi.advanceTimersByTimeAsync(0);
    flushThreeRequests(httpMock, makeAdherenceResponse(), { Incidents: [] }, []);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(30_000);
    flushThreeRequests(httpMock,
      makeAdherenceResponse([{ lineCode: 'BL', total: 5, onTime: 5, minor: 0, significant: 0 }]),
      { Incidents: [] },
      []
    );
    await vi.advanceTimersByTimeAsync(0);

    const blCard = findLineCard(fixture.nativeElement, 'Blue')!;
    expect(blCard.querySelector('.adherence-pct')?.textContent?.trim()).toBe('100%');
  });
});
