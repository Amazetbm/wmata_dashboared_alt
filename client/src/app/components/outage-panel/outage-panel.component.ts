import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

type View       = 'live' | 'historical';
type TypeFilter = 'ALL' | 'ELEVATOR' | 'ESCALATOR';
type HistPreset = '24h' | '7d' | 'custom';

interface OutageRecord {
  UnitName: string;
  UnitType: string;
  StationCode: string;
  StationName: string;
  LocationDescription: string;
  SymptomDescription: string;
  TimeOutOfService: string;
  EstimatedReturnToService: string | null;
  DateUpdated: string;
  adaConcern: boolean;
  durationMs: number;
  durationLabel: string;
  durationClass: 'normal' | 'amber' | 'red';
}

interface ChartPoint { date: string; elevators: number; escalators: number; }

@Component({
  selector: 'app-outage-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './outage-panel.component.html',
  styleUrl: './outage-panel.component.scss',
})
export class OutagePanelComponent implements OnInit, OnDestroy {
  view: View = 'live';

  // Filters — independent from line filter used by other panels
  typeFilter: TypeFilter = 'ALL';
  stationSearch = '';

  // ── Live ────────────────────────────────────────────────────────────
  outages: OutageRecord[] = [];
  loading = true;
  error = '';
  private liveTimer: any;

  get liveSummary() {
    const adaCount = new Set(this.outages.filter(o => o.adaConcern).map(o => o.StationCode)).size;
    return {
      total:      this.outages.length,
      elevators:  this.outages.filter(o => o.UnitType === 'ELEVATOR').length,
      escalators: this.outages.filter(o => o.UnitType === 'ESCALATOR').length,
      adaStations: adaCount,
    };
  }

  get liveDisplayed(): OutageRecord[] {
    return this.sortOutages(this.applyFilters(this.outages));
  }

  // ── Historical ──────────────────────────────────────────────────────
  histPreset: HistPreset = '24h';
  histFrom = '';
  histTo = '';
  histLoading = false;
  histError = '';
  histOutages: OutageRecord[] = [];
  histChartData: ChartPoint[] = [];
  hasFetched = false;

  get histDisplayed(): OutageRecord[] {
    return this.sortOutages(this.applyFilters(this.histOutages));
  }

  @ViewChild('outageChartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;

  constructor(private wmata: WmataService) {}

  ngOnInit() {
    this.setHistPresetDates('24h');
    this.loadLive();
    this.liveTimer = setInterval(() => this.loadLive(), 30000);
  }

  ngOnDestroy() {
    clearInterval(this.liveTimer);
    this.chart?.destroy();
  }

  // ── Live ────────────────────────────────────────────────────────────

  loadLive() {
    this.wmata.getLiveOutages().subscribe({
      next: (raw: any[]) => {
        const ada = this.computeAdaSet(raw);
        this.outages = raw.map(o => this.enrich(o, ada.has(o.StationCode)));
        this.loading = false;
        this.error = '';
      },
      error: err => { this.error = err.message; this.loading = false; }
    });
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

  // ── Historical ──────────────────────────────────────────────────────

  onHistPresetChange() {
    if (this.histPreset !== 'custom') {
      this.setHistPresetDates(this.histPreset);
      this.fetchHistory();
    }
  }

  private setHistPresetDates(p: HistPreset) {
    const now = new Date();
    const msAgo = p === '24h' ? 24 * 3600_000 : 7 * 24 * 3600_000;
    this.histFrom = this.toLocalDatetime(new Date(now.getTime() - msAgo));
    this.histTo   = this.toLocalDatetime(now);
  }

  private toLocalDatetime(d: Date): string {
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  fetchHistory() {
    if (!this.histFrom || !this.histTo) return;
    this.histLoading = true;
    this.histError = '';

    this.wmata.getOutageHistory(
      new Date(this.histFrom).toISOString(),
      new Date(this.histTo).toISOString(),
    ).subscribe({
      next: (data: any) => {
        this.histOutages = (data.outages || []).map((o: any) =>
          this.enrich(o, o.adaConcern ?? false)
        );
        this.histChartData = data.chartData || [];
        this.hasFetched = true;
        this.histLoading = false;
        setTimeout(() => this.updateChart(), 0);
      },
      error: err => { this.histError = err.message; this.histLoading = false; }
    });
  }

  // ── Chart ───────────────────────────────────────────────────────────

  private initChart() {
    if (!this.chartCanvas) return;
    const ctx = this.chartCanvas.nativeElement.getContext('2d')!;
    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: this.histChartData.map(d => d.date),
        datasets: [
          {
            label: 'Elevators',
            data: this.histChartData.map(d => d.elevators),
            backgroundColor: 'rgba(137,180,250,0.8)',
            borderColor: '#89b4fa',
            borderWidth: 1,
          },
          {
            label: 'Escalators',
            data: this.histChartData.map(d => d.escalators),
            backgroundColor: 'rgba(249,226,175,0.8)',
            borderColor: '#f9e2af',
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#6c7086' },
            grid: { color: '#313244' },
          },
          y: {
            stacked: true,
            ticks: { color: '#6c7086', precision: 0 },
            grid: { color: '#313244' },
          },
        },
        plugins: {
          legend: { labels: { color: '#cdd6f4', font: { size: 11 } } },
          tooltip: {
            backgroundColor: '#1e1e2e',
            titleColor: '#cdd6f4',
            bodyColor: '#a6adc8',
          },
        },
      },
    });
  }

  private updateChart() {
    if (!this.chartCanvas) return;
    if (this.chart) {
      this.chart.data.labels = this.histChartData.map(d => d.date);
      this.chart.data.datasets[0].data = this.histChartData.map(d => d.elevators);
      this.chart.data.datasets[1].data = this.histChartData.map(d => d.escalators);
      this.chart.update();
    } else {
      this.initChart();
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private computeAdaSet(raw: any[]): Set<string> {
    const elevs = new Set(raw.filter(o => o.UnitType === 'ELEVATOR').map(o => o.StationCode));
    const escs  = new Set(raw.filter(o => o.UnitType === 'ESCALATOR').map(o => o.StationCode));
    return new Set([...elevs].filter(s => escs.has(s)));
  }

  private enrich(o: any, adaConcern: boolean): OutageRecord {
    const outTime = new Date(o.TimeOutOfService).getTime();
    const now = Date.now();
    // Reject dates that are invalid, in the future, or implausibly old (pre-2000).
    // WMATA sends DateTime.MinValue (~year 0001) when the field isn't recorded.
    const MIN_VALID = new Date('2000-01-01').getTime();
    const valid = !isNaN(outTime) && outTime >= MIN_VALID && outTime <= now;
    const ms = valid ? now - outTime : 0;

    let durationLabel: string;
    let durationClass: 'normal' | 'amber' | 'red';
    if (!valid) {
      durationLabel = '—';
      durationClass = 'normal';
    } else {
      const hours = Math.floor(ms / 3600000);
      const days  = Math.floor(hours / 24);
      const remH  = hours % 24;
      durationLabel = days > 0 ? `${days}d ${remH}h` : `${hours}h`;
      durationClass = ms > 72 * 3600000 ? 'red' : ms > 24 * 3600000 ? 'amber' : 'normal';
    }
    return { ...o, adaConcern, durationMs: ms, durationLabel, durationClass };
  }

  private applyFilters(list: OutageRecord[]): OutageRecord[] {
    let r = list;
    if (this.typeFilter !== 'ALL') r = r.filter(o => o.UnitType === this.typeFilter);
    if (this.stationSearch.trim()) {
      const q = this.stationSearch.trim().toLowerCase();
      r = r.filter(o => o.StationName.toLowerCase().includes(q));
    }
    return r;
  }

  private sortOutages(list: OutageRecord[]): OutageRecord[] {
    return [...list].sort((a, b) => {
      if (a.adaConcern !== b.adaConcern) return a.adaConcern ? -1 : 1;
      return b.durationMs - a.durationMs;
    });
  }

  formatDate(d: string): string {
    if (!d) return '—';
    return new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  formatEst(est: string | null): string {
    if (!est) return 'No estimate';
    return new Date(est).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
