import { TestBed } from '@angular/core/testing';
import { MapCommandService, MapAction } from './map-command.service';

describe('MapCommandService', () => {
  let service: MapCommandService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [MapCommandService] });
    service = TestBed.inject(MapCommandService);
  });

  it('dispatch() value reaches stream$ subscribers', () => {
    const received: MapAction[] = [];
    service.stream$.subscribe(a => received.push(a));

    service.dispatch({ action: 'focus_line', target: 'RD' });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ action: 'focus_line', target: 'RD' });
  });

  it('late subscribers do NOT receive past actions (Subject, not BehaviorSubject)', () => {
    service.dispatch({ action: 'focus_line', target: 'RD' });

    const received: MapAction[] = [];
    service.stream$.subscribe(a => received.push(a));

    expect(received).toHaveLength(0);
  });

  it('multiple dispatches all reach subscribers', () => {
    const received: MapAction[] = [];
    service.stream$.subscribe(a => received.push(a));

    service.dispatch({ action: 'focus_line', target: 'BL' });
    service.dispatch({ action: 'focus_station', target: 'A01' });
    service.dispatch({ action: 'focus_route', target: '10A' });

    expect(received).toHaveLength(3);
  });

  it('setPendingBusAction / drainPendingBusAction round-trip', () => {
    service.setPendingBusAction({ action: 'focus_route', target: '7Y' });

    const drained = service.drainPendingBusAction();
    expect(drained).toEqual({ action: 'focus_route', target: '7Y' });
  });

  it('drain clears the slot (second drain returns null)', () => {
    service.setPendingBusAction({ action: 'focus_route', target: '10A' });
    service.drainPendingBusAction();

    expect(service.drainPendingBusAction()).toBeNull();
  });

  it('drainPendingBusAction returns null when nothing was set', () => {
    expect(service.drainPendingBusAction()).toBeNull();
  });
});
