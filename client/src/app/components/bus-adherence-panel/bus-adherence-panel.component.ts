import { Component, ViewChild, ElementRef, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';
import { Chart, registerables } from 'chart.js';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer, EMPTY, Subject, merge, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

Chart.register(...registerables);

type View = 'live' | 'historical';
type Preset = '3h' | '24h' | '7d' | 'custom';

interface BusSummary {
  total: number; early: number; onTime: number; minor: number; significant: number;
  noPrediction: number; canceled: number; unscheduled: number; added: number;
  inactive?: number;
  methodCounts?: { timepoint: number; tripDelay: number };
}

interface RouteSummary {
  routeId: string; total: number; early: number; onTime: number;
  minor: number; significant: number; noPrediction: number;
}

interface ScheduleRoute { routeId: string; shortName: string; longName: string; }

interface BusRecord {
  vehicleId: string; routeId: string; tripId: string | null;
  delaySeconds: number | null; delayLabel: string | null;
}

interface HistSnap { snapshotAt: string; summary: BusSummary; }

const serverMsg = (err: any): string =>
  err?.error?.error || err?.error?.message || err?.message || 'Failed to load';

@Component({
  selector: 'app-bus-adherence-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bus-adherence-panel.component.html',
  styleUrl: './bus-adherence-panel.component.scss',
})
export class BusAdherencePanelComponent {
  view: View = 'live';

  // Route filter
  selectedRoute = '';

  // Live state
  buses = signal<BusRecord[]>([]);
  routeSummaries = signal<RouteSummary[]>([]);
  scheduleRoutes = signal<ScheduleRoute[]>([]);
  summary = signal<BusSummary>({ total: 0, early: 0, onTime: 0, minor: 0, significant: 0, noPrediction: 0, canceled: 0, unscheduled: 0, added: 0 });
  loading = signal(true);
  error = signal('');
  snapshotAt = signal<string | null>(null);
  coverageRate = signal<number | null>(null);
  degraded = signal(false);
  noPredictionCount = signal(0);
  inactiveCount = signal(0);

  // Historical state
  histPreset: Preset = '3h';
  histCustomFrom = '';
  histCustomTo = '';
  histLoading = signal(false);
  histError = signal('');

  @ViewChild('histChart') histChartRef!: ElementRef<HTMLCanvasElement>;
  private histChart: Chart | null = null;
  private reload$ = new Subject<void>();

  private wmata = inject(WmataService);
  private destroyRef = inject(DestroyRef);

  constructor() {
    // 30-second live poll; also fires immediately when reload$ emits
    merge(timer(0, 30_000), this.reload$).pipe(
      switchMap(() => this.wmata.getLiveBusScheduleAdherence(this.selectedRoute || undefined).pipe(
        catchError(err => { this.error.set(serverMsg(err)); this.loading.set(false); return EMPTY; }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: data => {
        this.loading.set(false);
        this.error.set('');
        this.snapshotAt.set(data.snapshotAt ?? null);
        this.coverageRate.set(data.coverageRate ?? null);
        this.degraded.set(data.degraded ?? false);
        const sum: BusSummary = data.summary ?? { total: 0, early: 0, onTime: 0, minor: 0, significant: 0, noPrediction: 0, canceled: 0, unscheduled: 0, added: 0 };
        this.summary.set(sum);
        this.noPredictionCount.set(sum.noPrediction ?? 0);
        this.inactiveCount.set(sum.inactive ?? 0);
        this.routeSummaries.set(data.routeSummaries ?? []);
        const rawBuses: BusRecord[] = (data.buses ?? []).slice().sort((a: BusRecord, b: BusRecord) =>
          (b.delaySeconds ?? 0) - (a.delaySeconds ?? 0)
        );
        this.buses.set(rawBuses);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Failed to load bus schedule adherence data');
      },
    });

    // Load schedule routes once for the route dropdown
    this.wmata.getBusScheduleRoutes().pipe(
      catchError(() => of([])),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(routes => this.scheduleRoutes.set(routes));
  }

  onRouteChange(): void {
    this.reload$.next();
  }

  onViewChange(newView: View): void {
    this.view = newView;
    if (newView === 'historical') {
      // Load immediately on tab switch
      setTimeout(() => this.loadHistorical(), 0);
    }
  }

  onHistPresetChange(): void {
    if (this.histPreset !== 'custom') {
      this.loadHistorical();
    }
  }

  loadHistorical(): void {
    const { from, to } = this.getHistRange();
    if (!from || !to) return;
    this.histLoading.set(true);
    this.histError.set('');
    this.wmata.getHistoricalBusScheduleAdherence(from, to, this.selectedRoute || undefined)
      .subscribe({
        next: (snapshots: HistSnap[]) => {
          this.histLoading.set(false);
          this.renderHistChart(snapshots);
        },
        error: (err) => {
          this.histLoading.set(false);
          this.histError.set(serverMsg(err));
        },
      });
  }

  private getHistRange(): { from: string; to: string } {
    const now = new Date();
    const to = now.toISOString();
    if (this.histPreset === '3h')  return { from: new Date(now.getTime() - 3  * 3600_000).toISOString(), to };
    if (this.histPreset === '24h') return { from: new Date(now.getTime() - 24 * 3600_000).toISOString(), to };
    if (this.histPreset === '7d')  return { from: new Date(now.getTime() - 7  * 86400_000).toISOString(), to };
    return { from: this.histCustomFrom, to: this.histCustomTo };
  }

  private renderHistChart(snapshots: HistSnap[]): void {
    if (!this.histChartRef?.nativeElement) return;
    if (this.histChart) { this.histChart.destroy(); this.histChart = null; }

    const labels = snapshots.map(s => new Date(s.snapshotAt).toLocaleTimeString());
    const onTimePcts = snapshots.map(s => {
      const sum = s.summary;
      const predicted = (sum.early ?? 0) + (sum.onTime ?? 0) + (sum.minor ?? 0) + (sum.significant ?? 0);
      return predicted > 0 ? Math.round((sum.onTime / predicted) * 100) : null;
    });
    const minorPcts = snapshots.map(s => {
      const sum = s.summary;
      const predicted = (sum.early ?? 0) + (sum.onTime ?? 0) + (sum.minor ?? 0) + (sum.significant ?? 0);
      return predicted > 0 ? Math.round((sum.minor / predicted) * 100) : null;
    });
    const significantPcts = snapshots.map(s => {
      const sum = s.summary;
      const predicted = (sum.early ?? 0) + (sum.onTime ?? 0) + (sum.minor ?? 0) + (sum.significant ?? 0);
      return predicted > 0 ? Math.round((sum.significant / predicted) * 100) : null;
    });

    this.histChart = new Chart(this.histChartRef.nativeElement, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'On Time %', data: onTimePcts, borderColor: '#00B140', backgroundColor: 'rgba(0,177,64,0.15)', fill: true, spanGaps: false },
          { label: 'Minor %',   data: minorPcts,  borderColor: '#ED8B00', backgroundColor: 'rgba(237,139,0,0.15)', fill: true, spanGaps: false },
          { label: 'Significant %', data: significantPcts, borderColor: '#BF0000', backgroundColor: 'rgba(191,0,0,0.15)', fill: true, spanGaps: false },
        ],
      },
      options: {
        responsive: true,
        spanGaps: false,
        scales: { y: { min: 0, max: 100 } },
      },
    });
  }

  formatDelay(seconds: number | null): string {
    if (seconds == null) return '—';
    const abs = Math.abs(seconds);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    const sign = seconds < 0 ? '−' : '+';
    return `${sign}${m}m ${s}s`;
  }

  onTimePct(): number {
    const sum = this.summary();
    const predicted = (sum.early ?? 0) + (sum.onTime ?? 0) + (sum.minor ?? 0) + (sum.significant ?? 0);
    return predicted > 0 ? Math.round((sum.onTime / predicted) * 100) : 0;
  }
}
