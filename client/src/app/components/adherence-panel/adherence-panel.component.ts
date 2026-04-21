import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';

const LINE_COLORS: Record<string, string> = {
  RD: '#BF0000', BL: '#009CDE', YL: '#FFD700',
  OR: '#ED8B00', GR: '#00B140', SV: '#919D9D',
};

interface TrainAdherence {
  trainId: string;
  trainNumber: string;
  lineCode: string;
  directionNum: number;
  circuitId: number;
  currentSeq: number;
  expectedSeq: number;
  deviation: number;
  status: 'on-time' | 'minor' | 'significant';
  carCount: number;
}

interface Summary { total: number; onTime: number; minor: number; significant: number; }

@Component({
  selector: 'app-adherence-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './adherence-panel.component.html',
  styleUrl: './adherence-panel.component.scss'
})
export class AdherencePanelComponent implements OnInit, OnDestroy {
  allTrains: TrainAdherence[] = [];
  filtered: TrainAdherence[] = [];
  summary: Summary = { total: 0, onTime: 0, minor: 0, significant: 0 };
  loading = true;
  error = '';
  selectedLine = '';
  lines = ['', 'RD', 'BL', 'YL', 'OR', 'GR', 'SV'];
  lineColors = LINE_COLORS;
  snapshotAt: string | null = null;
  private timer: any;

  constructor(private wmata: WmataService) {}

  ngOnInit() {
    this.load();
    this.timer = setInterval(() => this.load(), 30000);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

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
      error: err => {
        this.error = err.message;
        this.loading = false;
      }
    });
  }

  applyFilter() {
    this.filtered = this.selectedLine
      ? this.allTrains.filter(t => t.lineCode === this.selectedLine)
      : this.allTrains;
  }

  onLineChange() { this.applyFilter(); }

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
