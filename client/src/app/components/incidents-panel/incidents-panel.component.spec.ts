import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { IncidentsPanelComponent } from './incidents-panel.component';
import { WmataService } from '../../services/wmata.service';

describe('IncidentsPanelComponent', () => {
  let fixture: ComponentFixture<IncidentsPanelComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    vi.useFakeTimers();

    await TestBed.configureTestingModule({
      imports: [IncidentsPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), WmataService],
    }).compileComponents();

    fixture = TestBed.createComponent(IncidentsPanelComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
  });

  it('re-renders when timer fires and new HTTP response arrives', () => {
    fixture.detectChanges(); // ngOnInit → subscribes to timer(0, 30_000)
    vi.advanceTimersByTime(0); // fires timer(0) → switchMap → req1

    const req1 = httpMock.expectOne('/api/incidents/live');
    req1.flush({ Incidents: [{ IncidentType: 'Delay', Description: 'Red Line delays', LinesAffected: 'RD;', PassengerDelay: 5, DateUpdated: '' }] });

    fixture.detectChanges();

    let cards = fixture.nativeElement.querySelectorAll('.incident-card');
    expect(cards.length).toBe(1);

    // Advance 30 s → timer ticks → req2 fires
    vi.advanceTimersByTime(30_000);

    const req2 = httpMock.expectOne('/api/incidents/live');
    req2.flush({
      Incidents: [
        { IncidentType: 'Delay', Description: 'Red Line delays', LinesAffected: 'RD;', PassengerDelay: 5, DateUpdated: '' },
        { IncidentType: 'Alert', Description: 'Blue Line alert', LinesAffected: 'BL;', PassengerDelay: 0, DateUpdated: '' },
      ]
    });

    fixture.detectChanges();

    cards = fixture.nativeElement.querySelectorAll('.incident-card');
    expect(cards.length).toBe(2);
  });
});
