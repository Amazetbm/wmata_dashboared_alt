import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';

const LINE_COLORS: Record<string, string> = {
  RD: '#BF0000', BL: '#009CDE', YL: '#FFD700',
  OR: '#ED8B00', GR: '#00B140', SV: '#919D9D',
};

@Component({
  selector: 'app-train-positions-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './train-positions-panel.component.html',
  styleUrl: './train-positions-panel.component.scss'
})
export class TrainPositionsPanelComponent implements OnInit, OnDestroy {
  allTrains: any[] = [];
  filtered: any[] = [];
  loading = true;
  error = '';
  selectedLine = '';
  lines = ['', 'RD', 'BL', 'YL', 'OR', 'GR', 'SV'];
  lineColors = LINE_COLORS;
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
    this.wmata.getLiveTrains().subscribe({
      next: data => {
        this.allTrains = data.TrainPositions || [];
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
      ? this.allTrains.filter(t => t.LineCode === this.selectedLine)
      : this.allTrains;
  }

  onLineChange() {
    this.applyFilter();
  }

  colorFor(line: string): string {
    return this.lineColors[line] || '#888';
  }
}
