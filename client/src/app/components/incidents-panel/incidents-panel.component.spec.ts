import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { IncidentsPanelComponent } from './incidents-panel.component';
import { WmataService } from '../../services/wmata.service';
import { makeIncident } from '../../../testing/api-fixtures';

describe('IncidentsPanelComponent', () => {
  let fixture: ComponentFixture<IncidentsPanelComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

    await TestBed.configureTestingModule({
      imports: [IncidentsPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), WmataService],
    }).compileComponents();

    fixture = TestBed.createComponent(IncidentsPanelComponent);
    fixture.autoDetectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
  });

  it('renders incident cards on initial load', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/incidents/live');
    req.flush({ Incidents: [makeIncident()] });
    await vi.advanceTimersByTimeAsync(0);

    const cards = fixture.nativeElement.querySelectorAll('.incident-card');
    expect(cards.length).toBe(1);
  });

  it('shows empty state when no incidents', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/incidents/live');
    req.flush({ Incidents: [] });
    await vi.advanceTimersByTimeAsync(0);

    const cards = fixture.nativeElement.querySelectorAll('.incident-card');
    expect(cards.length).toBe(0);
  });

  it('re-renders with new data on 30 s refresh', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne('/api/incidents/live');
    req1.flush({ Incidents: [makeIncident()] });
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelectorAll('.incident-card').length).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    const req2 = httpMock.expectOne('/api/incidents/live');
    req2.flush({ Incidents: [makeIncident(), makeIncident({ LinesAffected: 'BL;' })] });
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelectorAll('.incident-card').length).toBe(2);
  });

  it('sets error signal on HTTP error', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/incidents/live');
    req.flush({ error: 'fail' }, { status: 500, statusText: 'Error' });
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelector('.error')).toBeTruthy();
  });

  it('clears error on subsequent success', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne('/api/incidents/live');
    req1.flush({ error: 'fail' }, { status: 500, statusText: 'Error' });
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelector('.error')).toBeTruthy();

    await vi.advanceTimersByTimeAsync(30_000);
    const req2 = httpMock.expectOne('/api/incidents/live');
    req2.flush({ Incidents: [makeIncident()] });
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelector('.error')).toBeFalsy();
  });
});
