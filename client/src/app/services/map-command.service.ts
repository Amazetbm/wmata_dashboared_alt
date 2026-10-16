import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type MapAction =
  | { action: 'focus_line';    target: string }
  | { action: 'focus_station'; target: string }
  | { action: 'focus_route';   target: string };

/**
 * Singleton service for dispatching map commands from the assistant panel to map components.
 * Uses a Subject (not BehaviorSubject) because commands are ephemeral imperative events —
 * late subscribers should not receive prior commands.
 * The pending bus action slot handles the case where a focus_route command arrives before
 * BusMapComponent has lazy-loaded.
 */
@Injectable({ providedIn: 'root' })
export class MapCommandService {
  private readonly commands$ = new Subject<MapAction>();
  private pendingBusAction: MapAction | null = null;

  readonly stream$ = this.commands$.asObservable();

  dispatch(action: MapAction): void {
    this.commands$.next(action);
  }

  setPendingBusAction(action: MapAction): void {
    this.pendingBusAction = action;
  }

  drainPendingBusAction(): MapAction | null {
    const action = this.pendingBusAction;
    this.pendingBusAction = null;
    return action;
  }
}
