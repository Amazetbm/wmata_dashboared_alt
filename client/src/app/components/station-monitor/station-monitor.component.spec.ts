import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { StationMonitorComponent } from './station-monitor.component';
import { WmataService } from '../../services/wmata.service';

describe('StationMonitorComponent', () => {
  let fixture: ComponentFixture<StationMonitorComponent>;
  let component: StationMonitorComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StationMonitorComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), WmataService],
    }).compileComponents();

    fixture = TestBed.createComponent(StationMonitorComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('renders predictions when HTTP response arrives without extra user event', () => {
    fixture.detectChanges(); // triggers ngOnInit → merge(of(void 0), ...) fires → req fires

    const req = httpMock.expectOne('/api/predictions/A01');
    req.flush({ Trains: [{ Line: 'RD', DestinationName: 'Glenmont', Car: '6', Min: '3' }] });

    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Glenmont');
  });

  it('discards in-flight response when station changes', () => {
    fixture.detectChanges(); // req1 fires for A01

    // Confirm req1 is pending
    httpMock.expectOne('/api/predictions/A01');

    // User switches to C05 — switchMap cancels req1 and fires req2
    component.selectedCode = 'C05';
    component.onStationChange();

    // req1 is now cancelled; req2 is the only pending request
    const req2 = httpMock.expectOne('/api/predictions/C05');
    req2.flush({ Trains: [{ Line: 'BL', DestinationName: 'Largo Town Center', Car: '8', Min: '2' }] });

    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Largo Town Center');
    // httpMock.verify() in afterEach confirms no orphaned requests
  });
});
