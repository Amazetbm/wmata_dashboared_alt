import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { StationMonitorComponent } from './station-monitor.component';
import { WmataService } from '../../services/wmata.service';
import { makePrediction } from '../../../testing/api-fixtures';

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
    fixture.autoDetectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('renders predictions on initial load', async () => {
    const req = httpMock.expectOne('/api/predictions/A01');
    req.flush({ Trains: [makePrediction()] });
    await fixture.whenStable();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Glenmont');
  });

  it('shows empty state when no trains', async () => {
    const req = httpMock.expectOne('/api/predictions/A01');
    req.flush({ Trains: [] });
    await fixture.whenStable();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(0);
  });

  it('sets error signal on HTTP error', async () => {
    const req = httpMock.expectOne('/api/predictions/A01');
    req.flush({ error: 'fail' }, { status: 500, statusText: 'Error' });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.error')).toBeTruthy();
  });

  it('discards in-flight response when station changes', async () => {
    await fixture.whenStable(); // initial request for A01 is pending
    const req1 = httpMock.expectOne('/api/predictions/A01');
    // Change station via real DOM select before flushing req1
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    select.value = select.options[1].value; // A14 (Rockville)
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    // req1 was in-flight; switchMap cancelled it — expectOne() already removed it from
    // the pending list so httpMock.verify() won't complain; do not flush cancelled request
    const req2 = httpMock.expectOne(`/api/predictions/${select.options[1].value}`);
    req2.flush({ Trains: [makePrediction({ Line: 'RD', DestinationName: 'Shady Grove' })] });
    await fixture.whenStable();
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
  });
});
