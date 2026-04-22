import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';
import { Chart, registerables } from 'chart.js';

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
  allTrains: TrainAdherence[] = [];
  filtered: TrainAdherence[] = [];
  summary: Summary = { total: 0, onTime: 0, minor: 0, significant: 0 };
  loading = true;
  error = '';
  snapshotAt: string | null = null;
  private liveTimer: any;

  // ── Historical ──────────────────────────────────────────────────────
  preset: Preset = '3h';
  from = '';
  to = '';
  histLoading = false;
  histError = '';
  histSnapshots: HistSnap[] = [];
  buckets: BucketPoint[] = [];
  hasFetched = false;

  get avgOnTimePct(): number {
    if (!this.buckets.length) return 0;
    return Math.round(this.buckets.reduce((a, b) => a + b.onTimePct, 0) / this.buckets.length);
  }
  get worstBucket(): BucketPoint | null {
    if (!this.buckets.length) return null;
    return this.buckets.reduce((min, b) => b.onTimePct < min.onTimePct ? b : min);
  }
  get bestBucket(): BucketPoint | null {
    if (!this.buckets.length) return null;
    return this.buckets.reduce((max, b) => b.onTimePct > max.onTimePct ? b : max);
  }

  // ── Drill-down ──────────────────────────────────────────────────────
  drillBucket: BucketPoint | null = null;
  drillTrains: TrainAdherence[] = [];
  drillLoading = false;

  // ── Chart ───────────────────────────────────────────────────────────
  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;

  constructor(private wmata: WmataService) {}

  ngOnInit() {
    this.load();
    this.liveTimer = setInterval(() => this.load(), 30000);
    this.setPresetDates('3h');
  }

  ngOnDestroy() {
    clearInterval(this.liveTimer);
    this.chart?.destroy();
  }

  // ── Live ────────────────────────────────────────────────────────────

  load() {
    this.wmata.getLiveAdherence().subscribe({
      next: data => {
        this.allTrains = data.trains || [];
        this.summary = data.summary || { total: 0, onTime: 0, minor: 0, significant: 0 };
        this.snapshotAt = data.snapshotAt || null;
        this.applyFilter();
        this.loading = false;
        this.error = '';
      },
      error: err => { this.error = err.message; this.loading = false; }
    });
  }

  applyFilter() {
    this.filtered = this.selectedLine
      ? this.allTrains.filter(t => t.lineCode === this.selectedLine)
      : this.allTrains;
  }

  // ── View switching ──────────────────────────────────────────────────

  switchView(v: View) {
    this.view = v;
    if (v === 'historical') {
      if (!this.hasFetched) {
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
    this.histLoading = true;
    this.histError = '';
    this.drillBucket = null;
    this.drillTrains = [];

    this.wmata.getHistoricalAdherence(
      new Date(this.from).toISOString(),
      new Date(this.to).toISOString(),
      this.selectedLine || undefined
    ).subscribe({
      next: data => {
        this.histSnapshots = Array.isArray(data) ? data : [];
        this.buckets = this.buildBuckets(this.histSnapshots);
        this.hasFetched = true;
        this.histLoading = false;
        setTimeout(() => this.updateChart(), 0);
      },
      error: err => { this.histError = err.message; this.histLoading = false; }
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

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: this.buckets.map(b => b.label),
        datasets: [
          {
            label: 'On-time',
            data: this.buckets.map(b => b.onTimePct),
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
            data: this.buckets.map(b => b.minorPct),
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
            data: this.buckets.map(b => b.significantPct),
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
                const pcts = [
                  this.buckets[idx]?.onTimePct,
                  this.buckets[idx]?.minorPct,
                  this.buckets[idx]?.significantPct,
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
    if (this.chart) {
      this.chart.data.labels = this.buckets.map(b => b.label);
      this.chart.data.datasets[0].data = this.buckets.map(b => b.onTimePct);
      this.chart.data.datasets[1].data = this.buckets.map(b => b.minorPct);
      this.chart.data.datasets[2].data = this.buckets.map(b => b.significantPct);
      this.chart.update();
    } else {
      this.initChart();
    }
  }

  // ── Drill-down ──────────────────────────────────────────────────────

  onChartClick(idx: number) {
    const bucket = this.buckets[idx];
    if (!bucket) return;
    this.drillBucket = bucket;
    this.drillLoading = true;
    this.drillTrains = [];

    const mid = new Date((bucket.fromTs.getTime() + bucket.toTs.getTime()) / 2).toISOString();
    this.wmata.getAdherenceSnapshot(mid).subscribe({
      next: (data: any) => {
        let trains: TrainAdherence[] = data?.trains || [];
        if (this.selectedLine) trains = trains.filter(t => t.lineCode === this.selectedLine);
        this.drillTrains = [...trains].sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
        this.drillLoading = false;
      },
      error: () => { this.drillLoading = false; }
    });
  }

  closeDrill() {
    this.drillBucket = null;
    this.drillTrains = [];
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  colorFor(line: string): string { return this.lineColors[line] || '#888'; }

  pct(n: number): number {
    return this.summary.total > 0 ? Math.round((n / this.summary.total) * 100) : 0;
  }

  deviationLabel(dev: number): string {
    if (dev === 0) return '±0';
    return dev > 0 ? `+${dev}` : `${dev}`;
  }

  sortedFiltered(): TrainAdherence[] {
    return [...this.filtered].sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
  }
}
