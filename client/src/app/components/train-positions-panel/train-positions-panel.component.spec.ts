import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TrainPositionsPanelComponent } from './train-positions-panel.component';
import { WmataService } from '../../services/wmata.service';
import { makeTrain } from '../../../testing/api-fixtures';

describe('TrainPositionsPanelComponent', () => {
  let fixture: ComponentFixture<TrainPositionsPanelComponent>;
  let component: TrainPositionsPanelComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });

    await TestBed.configureTestingModule({
      imports: [TrainPositionsPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), WmataService],
    }).compileComponents();

    fixture = TestBed.createComponent(TrainPositionsPanelComponent);
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
    const req = httpMock.expectOne('/api/trains/located');
    req.flush({ trains: [makeTrain(), makeTrain({ trainId: 'T002', lineCode: 'BL' })] });
    await vi.advanceTimersByTimeAsync(0);

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('replaces rows on 30 s refresh', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne('/api/trains/located');
    req1.flush({ trains: [makeTrain()] });
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);
    const req2 = httpMock.expectOne('/api/trains/located');
    req2.flush({ trains: [makeTrain(), makeTrain({ trainId: 'T002' }), makeTrain({ trainId: 'T003' })] });
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('sets error signal on HTTP error', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/trains/located');
    req.flush({ error: 'fail' }, { status: 500, statusText: 'Error' });
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelector('.error')).toBeTruthy();
  });

  it('clears error on next success', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req1 = httpMock.expectOne('/api/trains/located');
    req1.flush({ error: 'fail' }, { status: 500, statusText: 'Error' });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(30_000);
    const req2 = httpMock.expectOne('/api/trains/located');
    req2.flush({ trains: [makeTrain()] });
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelector('.error')).toBeFalsy();
  });

  it('empty state renders no rows', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/trains/located');
    req.flush({ trains: [] });
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(0);
  });

  it('onLineChange filters displayed rows locally', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/trains/located');
    req.flush({ trains: [makeTrain({ lineCode: 'RD' }), makeTrain({ trainId: 'T002', lineCode: 'BL' })] });
    await vi.advanceTimersByTimeAsync(0);

    component.selectedLine = 'RD';
    component.onLineChange();
    await vi.advanceTimersByTimeAsync(0);

    expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('hasOccupancy is false when all occupancy null', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/trains/located');
    req.flush({ trains: [makeTrain({ occupancy: null }), makeTrain({ trainId: 'T002', occupancy: null })] });
    await vi.advanceTimersByTimeAsync(0);

    const ths = Array.from(fixture.nativeElement.querySelectorAll('th')) as HTMLElement[];
    expect(ths.find(th => th.textContent?.includes('Crowding'))).toBeFalsy();
  });

  it('hasOccupancy is true when at least one non-null occupancy', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/trains/located');
    req.flush({ trains: [makeTrain({ occupancy: { status: 2, label: 'FEW_SEATS_AVAILABLE' } })] });
    await vi.advanceTimersByTimeAsync(0);

    const ths = Array.from(fixture.nativeElement.querySelectorAll('th')) as HTMLElement[];
    expect(ths.find(th => th.textContent?.includes('Crowding'))).toBeTruthy();
  });

  // ── Mode toggle — headway (default) ─────────────────────────────────────────

  it('default mode is headway: Status column visible, Delay column absent', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/trains/located');
    req.flush({ trains: [makeTrain({ scheduleDelay: { seconds: 200, label: 'Slight Delay' } })] });
    await vi.advanceTimersByTimeAsync(0);

    expect(component.mode()).toBe('headway');
    const ths = Array.from(fixture.nativeElement.querySelectorAll('th')) as HTMLElement[];
    expect(ths.find(th => th.textContent?.trim() === 'Status')).toBeTruthy();
    expect(ths.find(th => th.textContent?.trim() === 'Delay')).toBeFalsy();
  });

  it('switching to schedule mode shows Delay column, hides Status column when data has delays', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/trains/located');
    req.flush({ trains: [makeTrain({ scheduleDelay: { seconds: 200, label: 'Slight Delay' } })] });
    await vi.advanceTimersByTimeAsync(0);

    component.mode.set('schedule');
    await vi.advanceTimersByTimeAsync(0);

    const ths = Array.from(fixture.nativeElement.querySelectorAll('th')) as HTMLElement[];
    expect(ths.find(th => th.textContent?.trim() === 'Status')).toBeFalsy();
    expect(ths.find(th => th.textContent?.trim() === 'Delay')).toBeTruthy();
  });

  it('showDelayColumn is false in schedule mode when all scheduleDelay null', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/trains/located');
    req.flush({ trains: [makeTrain({ scheduleDelay: null }), makeTrain({ trainId: 'T002', scheduleDelay: null })] });
    await vi.advanceTimersByTimeAsync(0);

    component.mode.set('schedule');
    await vi.advanceTimersByTimeAsync(0);

    expect(component.showDelayColumn).toBe(false);
    const ths = Array.from(fixture.nativeElement.querySelectorAll('th')) as HTMLElement[];
    expect(ths.find(th => th.textContent?.trim() === 'Delay')).toBeFalsy();
  });

  it('hasScheduleDelay is false when all scheduleDelay null', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/trains/located');
    req.flush({ trains: [makeTrain({ scheduleDelay: null }), makeTrain({ trainId: 'T002', scheduleDelay: null })] });
    await vi.advanceTimersByTimeAsync(0);

    expect(component.hasScheduleDelay).toBe(false);
  });

  it('hasScheduleDelay is true when at least one non-null scheduleDelay', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/trains/located');
    req.flush({ trains: [makeTrain({ scheduleDelay: { seconds: 200, label: 'Slight Delay' } })] });
    await vi.advanceTimersByTimeAsync(0);

    expect(component.hasScheduleDelay).toBe(true);
  });

  it('renders delay label in cell when in schedule mode with non-null scheduleDelay', async () => {
    await vi.advanceTimersByTimeAsync(0);
    const req = httpMock.expectOne('/api/trains/located');
    req.flush({ trains: [makeTrain({ scheduleDelay: { seconds: 700, label: 'Significant Delay' } })] });
    await vi.advanceTimersByTimeAsync(0);

    component.mode.set('schedule');
    await vi.advanceTimersByTimeAsync(0);

    const cell = fixture.nativeElement.querySelector('.delay-chip');
    expect(cell?.textContent?.trim()).toBe('Significant Delay');
  });
});
