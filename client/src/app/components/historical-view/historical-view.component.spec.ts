import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { HistoricalViewComponent } from './historical-view.component';
import { WmataService } from '../../services/wmata.service';
import { makeHistoricalRecord } from '../../../testing/api-fixtures';

describe('HistoricalViewComponent', () => {
  let fixture: ComponentFixture<HistoricalViewComponent>;
  let component: HistoricalViewComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HistoricalViewComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), WmataService],
    }).compileComponents();

    fixture = TestBed.createComponent(HistoricalViewComponent);
    component = fixture.componentInstance;
    fixture.autoDetectChanges();
    await fixture.whenStable();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('fetch() with dataType=incidents calls getHistoricalIncidents and renders rows', async () => {
    component.dataType = 'incidents';
    component.fetch();

    const req = httpMock.expectOne(r => r.url === '/api/incidents/history');
    req.flush([makeHistoricalRecord(), makeHistoricalRecord()]);
    await fixture.whenStable();

    expect(component.records().length).toBe(2);
  });

  it('fetch() with dataType=elevators calls getHistoricalElevators', async () => {
    component.dataType = 'elevators';
    component.fetch();

    const req = httpMock.expectOne(r => r.url === '/api/elevators/history');
    req.flush([makeHistoricalRecord()]);
    await fixture.whenStable();

    expect(component.records().length).toBe(1);
  });

  it('sets error signal on HTTP error', async () => {
    component.dataType = 'incidents';
    component.fetch();

    const req = httpMock.expectOne(r => r.url === '/api/incidents/history');
    req.flush({ error: 'fail' }, { status: 500, statusText: 'Error' });
    await fixture.whenStable();

    expect(component.error()).toBeTruthy();
  });

  it('empty state: empty array sets records to []', async () => {
    component.dataType = 'incidents';
    component.fetch();

    const req = httpMock.expectOne(r => r.url === '/api/incidents/history');
    req.flush([]);
    await fixture.whenStable();

    expect(component.records().length).toBe(0);
  });

  it('startReplay() advances replayIndex every 1500 ms and stops at end', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

    component.dataType = 'incidents';
    component.fetch();

    const req = httpMock.expectOne(r => r.url === '/api/incidents/history');
    const snap1 = new Date(Date.now() - 5 * 60_000).toISOString();
    const snap2 = new Date(Date.now() - 4 * 60_000).toISOString();
    req.flush([
      makeHistoricalRecord({ snapshotAt: snap1 }),
      makeHistoricalRecord({ snapshotAt: snap2 }),
    ]);
    await vi.advanceTimersByTimeAsync(0);

    component.startReplay();
    expect(component.replayIndex()).toBe(0);
    expect(component.isReplaying()).toBe(true);

    await vi.advanceTimersByTimeAsync(1500);
    expect(component.replayIndex()).toBe(1);

    await vi.advanceTimersByTimeAsync(1500);
    expect(component.isReplaying()).toBe(false);

    vi.useRealTimers();
  });
});
