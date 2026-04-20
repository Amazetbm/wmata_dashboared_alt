import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';

type DataType = 'incidents' | 'elevators';

@Component({
  selector: 'app-historical-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './historical-view.component.html',
  styleUrl: './historical-view.component.scss'
})
export class HistoricalViewComponent {
  dataType: DataType = 'incidents';
  from = '';
  to = '';
  records: any[] = [];
  loading = false;
  error = '';

  // Replay state
  replayIndex = -1;
  replayTimer: any;
  isReplaying = false;

  // Chart data — counts by snapshot timestamp
  chartData: { label: string; count: number }[] = [];

  constructor(private wmata: WmataService) {
    const now = new Date();
    const past = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    this.to = this.toLocalDatetime(now);
    this.from = this.toLocalDatetime(past);
  }

  private toLocalDatetime(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  fetch() {
    this.loading = true;
    this.stopReplay();
    this.records = [];
    this.chartData = [];
    this.replayIndex = -1;

    const obs = this.dataType === 'incidents'
      ? this.wmata.getHistoricalIncidents(new Date(this.from).toISOString(), new Date(this.to).toISOString())
      : this.wmata.getHistoricalElevators(new Date(this.from).toISOString(), new Date(this.to).toISOString());

    obs.subscribe({
      next: data => {
        this.records = Array.isArray(data) ? data : [];
        this.buildChartData();
        this.loading = false;
        this.error = '';
      },
      error: err => {
        this.error = err.message;
        this.loading = false;
      }
    });
  }

  private buildChartData() {
    const counts = new Map<string, number>();
    for (const r of this.records) {
      const label = new Date(r.snapshotAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    this.chartData = Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .slice(-30);
  }

  get maxCount(): number {
    return Math.max(...this.chartData.map(d => d.count), 1);
  }

  get snapshots(): string[] {
    const times = [...new Set(this.records.map(r => r.snapshotAt))].sort();
    return times;
  }

  get replayRecords(): any[] {
    if (this.replayIndex < 0 || this.replayIndex >= this.snapshots.length) return [];
    const snap = this.snapshots[this.replayIndex];
    return this.records.filter(r => r.snapshotAt === snap);
  }

  startReplay() {
    if (this.snapshots.length === 0) return;
    this.replayIndex = 0;
    this.isReplaying = true;
    this.replayTimer = setInterval(() => {
      this.replayIndex++;
      if (this.replayIndex >= this.snapshots.length) this.stopReplay();
    }, 1500);
  }

  stopReplay() {
    clearInterval(this.replayTimer);
    this.isReplaying = false;
  }
}
