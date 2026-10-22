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

    expect(component.error()).toBeTruthy();
  });

  it('discards in-flight response when station changes', async () => {
    httpMock.expectOne('/api/predictions/A01');

    component.selectedCode = 'C05';
    component.onStationChange();

    const req2 = httpMock.expectOne('/api/predictions/C05');
    req2.flush({ Trains: [makePrediction({ Line: 'BL', DestinationName: 'Largo Town Center' })] });
    await fixture.whenStable();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Largo Town Center');
  });
});
