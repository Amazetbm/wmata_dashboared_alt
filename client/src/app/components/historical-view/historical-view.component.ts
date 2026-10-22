import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';
import { Subscription, interval } from 'rxjs';

type DataType = 'incidents' | 'elevators';

@Component({
  selector: 'app-historical-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './historical-view.component.html',
  styleUrl: './historical-view.component.scss'
})
export class HistoricalViewComponent implements OnInit, OnDestroy {
  dataType: DataType = 'incidents';
  from = '';
  to = '';
  records = signal<any[]>([]);
  loading = signal(false);
  error = signal('');

  replayIndex = signal(-1);
  isReplaying = signal(false);
  private replaySub: Subscription | null = null;

  chartData = signal<{ label: string; count: number }[]>([]);

  constructor(private wmata: WmataService) {}

  ngOnInit() {
    const now = new Date();
    const past = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    this.to = this.toLocalDatetime(now);
    this.from = this.toLocalDatetime(past);
  }

  ngOnDestroy() {
    this.stopReplay();
  }

  private toLocalDatetime(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  fetch() {
    this.loading.set(true);
    this.stopReplay();
    this.records.set([]);
    this.chartData.set([]);
    this.replayIndex.set(-1);

    const fromIso = new Date(this.from).toISOString();
    const toIso = new Date(this.to).toISOString();

    const obs = this.dataType === 'incidents'
      ? this.wmata.getHistoricalIncidents(fromIso, toIso)
      : this.wmata.getHistoricalElevators(fromIso, toIso);

    obs.subscribe({
      next: data => {
        this.records.set(Array.isArray(data) ? data : []);
        this.buildChartData();
        this.loading.set(false);
        this.error.set('');
      },
      error: err => { this.error.set(err.message); this.loading.set(false); }
    });
  }

  private buildChartData() {
    const counts = new Map<string, number>();
    for (const r of this.records()) {
      const label = new Date(r.snapshotAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    this.chartData.set(
      Array.from(counts.entries())
        .map(([label, count]) => ({ label, count }))
        .slice(-30)
    );
  }

  get maxCount(): number {
    return Math.max(...this.chartData().map(d => d.count), 1);
  }

  get snapshots(): string[] {
    const times = [...new Set(this.records().map(r => r.snapshotAt))].sort();
    return times;
  }

  get replayRecords(): any[] {
    const idx = this.replayIndex();
    if (idx < 0 || idx >= this.snapshots.length) return [];
    const snap = this.snapshots[idx];
    return this.records().filter(r => r.snapshotAt === snap);
  }

  startReplay() {
    if (this.snapshots.length === 0) return;
    this.stopReplay();
    this.isReplaying.set(true);
    this.replayIndex.set(0);
    this.replaySub = interval(1500).subscribe(() => {
      const next = this.replayIndex() + 1;
      if (next >= this.snapshots.length) this.stopReplay();
      else this.replayIndex.set(next);
    });
  }

  stopReplay() {
    this.isReplaying.set(false);
    this.replaySub?.unsubscribe();
    this.replaySub = null;
  }
}
