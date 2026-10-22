import { Component, OnInit, OnDestroy, ViewChild, ElementRef, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';
import { Chart, registerables } from 'chart.js';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer, EMPTY } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

Chart.register(...registerables);

const LINE_COLORS: Record<string, string> = {
  RD: '#BF0000', BL: '#009CDE', YL: '#FFD700',
  OR: '#ED8B00', GR: '#00B140', SV: '#919D9D',
};

type View = 'live' | 'historical';
type Preset = '3h' | '24h' | '7d' | 'custom';

interface TrainAdherence {
  trainId: string; trainNumber: string; lineCode: string;
  directionNum: number; circuitId: number; currentSeq: number;
  expectedSeq: number; deviation: number;
  status: 'on-time' | 'minor' | 'significant'; carCount: number;
}

interface Summary { total: number; onTime: number; minor: number; significant: number; }
interface HistSnap { snapshotAt: string; summary: Summary; }
interface BucketPoint {
  label: string; fromTs: Date; toTs: Date;
  onTimePct: number; minorPct: number; significantPct: number;
}

@Component({
  selector: 'app-adherence-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './adherence-panel.component.html',
  styleUrl: './adherence-panel.component.scss'
})
export class AdherencePanelComponent implements OnInit, OnDestroy {
  view: View = 'live';

  // Shared line filter — persists across view switches
  selectedLine = '';
  lines = ['', 'RD', 'BL', 'YL', 'OR', 'GR', 'SV'];
  lineColors = LINE_COLORS;

  // ── Live ────────────────────────────────────────────────────────────
  allTrains = signal<TrainAdherence[]>([]);
  filtered = signal<TrainAdherence[]>([]);
  summary = signal<Summary>({ total: 0, onTime: 0, minor: 0, significant: 0 });
  loading = signal(true);
  error = signal('');
  snapshotAt = signal<string | null>(null);
  private destroyRef = inject(DestroyRef);

  // ── Historical ──────────────────────────────────────────────────────
  preset: Preset = '3h';
  from = '';
  to = '';
  histLoading = signal(false);
  histError = signal('');
  histSnapshots = signal<HistSnap[]>([]);
  buckets = signal<BucketPoint[]>([]);
  hasFetched = signal(false);

  get avgOnTimePct(): number {
    const b = this.buckets();
    if (!b.length) return 0;
    return Math.round(b.reduce((a, x) => a + x.onTimePct, 0) / b.length);
  }
  get worstBucket(): BucketPoint | null {
    const b = this.buckets();
    if (!b.length) return null;
    return b.reduce((min, x) => x.onTimePct < min.onTimePct ? x : min);
  }
  get bestBucket(): BucketPoint | null {
    const b = this.buckets();
    if (!b.length) return null;
    return b.reduce((max, x) => x.onTimePct > max.onTimePct ? x : max);
  }

  // ── Drill-down ──────────────────────────────────────────────────────
  drillBucket = signal<BucketPoint | null>(null);
  drillTrains = signal<TrainAdherence[]>([]);
  drillLoading = signal(false);

  // ── Chart ───────────────────────────────────────────────────────────
  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;

  constructor(private wmata: WmataService) {}

  ngOnInit() {
    timer(0, 30_000).pipe(
      switchMap(() => this.wmata.getLiveAdherence().pipe(
        catchError(err => { this.error.set(err.message); this.loading.set(false); return EMPTY; })
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(data => {
      this.allTrains.set(data.trains || []);
      this.summary.set(data.summary || { total: 0, onTime: 0, minor: 0, significant: 0 });
      this.snapshotAt.set(data.snapshotAt || null);
      this.applyFilter();
      this.loading.set(false);
      this.error.set('');
    });
    this.setPresetDates('3h');
  }

  ngOnDestroy() {
    this.chart?.destroy();
  }

  // ── Live ────────────────────────────────────────────────────────────

  applyFilter() {
    this.filtered.set(this.selectedLine
      ? this.allTrains().filter(t => t.lineCode === this.selectedLine)
      : this.allTrains());
  }

  // ── View switching ──────────────────────────────────────────────────

  switchView(v: View) {
    this.view = v;
    if (v === 'historical') {
      if (!this.hasFetched()) {
        this.fetchHistory();
      } else {
        setTimeout(() => this.updateChart(), 0);
      }
    }
  }

  // ── Shared line filter ──────────────────────────────────────────────

  onLineChange() {
    if (this.view === 'live') {
      this.applyFilter();
    } else {
      this.fetchHistory();
    }
  }

  // ── Historical ──────────────────────────────────────────────────────

  onPresetChange() {
    if (this.preset !== 'custom') {
      this.setPresetDates(this.preset);
      this.fetchHistory();
    }
  }

  private setPresetDates(p: Preset) {
    const now = new Date();
    const msAgo = p === '3h' ? 3 * 3600_000 : p === '24h' ? 24 * 3600_000 : 7 * 24 * 3600_000;
    this.from = this.toLocalDatetime(new Date(now.getTime() - msAgo));
    this.to   = this.toLocalDatetime(now);
  }

  private toLocalDatetime(d: Date): string {
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  fetchHistory() {
    if (!this.from || !this.to) return;
    this.histLoading.set(true);
    this.histError.set('');
    this.drillBucket.set(null);
    this.drillTrains.set([]);

    this.wmata.getHistoricalAdherence(
      new Date(this.from).toISOString(),
      new Date(this.to).toISOString(),
      this.selectedLine || undefined
    ).subscribe({
      next: data => {
        const snaps = Array.isArray(data) ? data : [];
        this.histSnapshots.set(snaps);
        this.buckets.set(this.buildBuckets(snaps));
        this.hasFetched.set(true);
        this.histLoading.set(false);
        setTimeout(() => this.updateChart(), 0);
      },
      error: err => { this.histError.set(err.message); this.histLoading.set(false); }
    });
  }

  private buildBuckets(snapshots: HistSnap[]): BucketPoint[] {
    if (!snapshots.length) return [];

    const first = new Date(snapshots[0].snapshotAt).getTime();
    const last  = new Date(snapshots[snapshots.length - 1].snapshotAt).getTime();
    const rangeMs = Math.max(last - first, 1);

    const bucketMs =
      rangeMs <= 6 * 3600_000  ? 5 * 60_000  :
      rangeMs <= 48 * 3600_000 ? 30 * 60_000 :
                                  3 * 3600_000;

    const map = new Map<number, HistSnap[]>();
    for (const snap of snapshots) {
      const key = Math.floor(new Date(snap.snapshotAt).getTime() / bucketMs) * bucketMs;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(snap);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([key, snaps]) => {
        const valid = snaps.filter(s => (s.summary?.total ?? 0) > 0);
        if (!valid.length) return null;
        const avg = (fn: (s: HistSnap) => number) =>
          Math.round(valid.reduce((a, s) => a + fn(s), 0) / valid.length);
        return {
          label: this.bucketLabel(key, rangeMs),
          fromTs: new Date(key),
          toTs: new Date(key + bucketMs),
          onTimePct:      avg(s => Math.round(s.summary.onTime      / s.summary.total * 100)),
          minorPct:       avg(s => Math.round(s.summary.minor       / s.summary.total * 100)),
          significantPct: avg(s => Math.round(s.summary.significant / s.summary.total * 100)),
        };
      })
      .filter((b): b is BucketPoint => b !== null);
  }

  private bucketLabel(ts: number, rangeMs: number): string {
    const d = new Date(ts);
    if (rangeMs > 24 * 3600_000) {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Chart ───────────────────────────────────────────────────────────

  private initChart() {
    if (!this.chartCanvas) return;
    const ctx = this.chartCanvas.nativeElement.getContext('2d')!;
    const b = this.buckets();

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: b.map(x => x.label),
        datasets: [
          {
            label: 'On-time',
            data: b.map(x => x.onTimePct),
            fill: true,
            backgroundColor: 'rgba(166,227,161,0.55)',
            borderColor: '#a6e3a1',
            borderWidth: 1.5,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
          {
            label: 'Minor',
            data: b.map(x => x.minorPct),
            fill: '-1',
            backgroundColor: 'rgba(249,226,175,0.65)',
            borderColor: '#f9e2af',
            borderWidth: 1.5,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
          {
            label: 'Significant',
            data: b.map(x => x.significantPct),
            fill: '-1',
            backgroundColor: 'rgba(243,139,168,0.7)',
            borderColor: '#f38ba8',
            borderWidth: 1.5,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#6c7086', maxTicksLimit: 12, maxRotation: 45 },
            grid: { color: '#313244' }
          },
          y: {
            stacked: true,
            min: 0,
            max: 100,
            ticks: {
              color: '#6c7086',
              callback: (v) => v + '%'
            },
            grid: { color: '#313244' }
          }
        },
        plugins: {
          legend: { labels: { color: '#cdd6f4', font: { size: 11 } } },
          tooltip: {
            backgroundColor: '#1e1e2e',
            titleColor: '#cdd6f4',
            bodyColor: '#a6adc8',
            callbacks: {
              label: (ctx) => {
                const idx = ctx.dataIndex;
                const buckets = this.buckets();
                const pcts = [
                  buckets[idx]?.onTimePct,
                  buckets[idx]?.minorPct,
                  buckets[idx]?.significantPct,
                ];
                return `${ctx.dataset.label}: ${pcts[ctx.datasetIndex] ?? ctx.parsed.y}%`;
              }
            }
          }
        },
        onClick: (_evt: any, elements: any[]) => {
          if (elements.length > 0) this.onChartClick(elements[0].index);
        }
      }
    });
  }

  private updateChart() {
    if (!this.chartCanvas) return;
    const b = this.buckets();
    if (this.chart) {
      this.chart.data.labels = b.map(x => x.label);
      this.chart.data.datasets[0].data = b.map(x => x.onTimePct);
      this.chart.data.datasets[1].data = b.map(x => x.minorPct);
      this.chart.data.datasets[2].data = b.map(x => x.significantPct);
      this.chart.update();
    } else {
      this.initChart();
    }
  }

  // ── Drill-down ──────────────────────────────────────────────────────

  onChartClick(idx: number) {
    const bucket = this.buckets()[idx];
    if (!bucket) return;
    this.drillBucket.set(bucket);
    this.drillLoading.set(true);
    this.drillTrains.set([]);

    const mid = new Date((bucket.fromTs.getTime() + bucket.toTs.getTime()) / 2).toISOString();
    this.wmata.getAdherenceSnapshot(mid).subscribe({
      next: (data: any) => {
        let trains: TrainAdherence[] = data?.trains || [];
        if (this.selectedLine) trains = trains.filter(t => t.lineCode === this.selectedLine);
        this.drillTrains.set([...trains].sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation)));
        this.drillLoading.set(false);
      },
      error: () => { this.drillLoading.set(false); }
    });
  }

  closeDrill() {
    this.drillBucket.set(null);
    this.drillTrains.set([]);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  colorFor(line: string): string { return this.lineColors[line] || '#888'; }

  pct(n: number): number {
    const s = this.summary();
    return s.total > 0 ? Math.round((n / s.total) * 100) : 0;
  }

  deviationLabel(dev: number): string {
    if (dev === 0) return '±0';
    return dev > 0 ? `+${dev}` : `${dev}`;
  }

  sortedFiltered(): TrainAdherence[] {
    return [...this.filtered()].sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
  }
}
