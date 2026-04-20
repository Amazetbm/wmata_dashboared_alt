import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';

const STATIONS: { code: string; name: string }[] = [
  { code: 'A01', name: 'Metro Center (RD)' },
  { code: 'C01', name: 'Metro Center (BL/OR/SV)' },
  { code: 'A02', name: 'Farragut North' },
  { code: 'A03', name: 'Dupont Circle' },
  { code: 'A04', name: 'Woodley Park' },
  { code: 'A05', name: 'Cleveland Park' },
  { code: 'B01', name: 'Gallery Pl-Chinatown (RD)' },
  { code: 'F01', name: 'Gallery Pl-Chinatown (GR/YL)' },
  { code: 'B02', name: 'Judiciary Square' },
  { code: 'B03', name: 'Union Station' },
  { code: 'D01', name: 'Federal Triangle' },
  { code: 'D03', name: 'L\'Enfant Plaza (BL/OR/SV)' },
  { code: 'F03', name: 'L\'Enfant Plaza (GR/YL)' },
];

@Component({
  selector: 'app-station-monitor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './station-monitor.component.html',
  styleUrl: './station-monitor.component.scss'
})
export class StationMonitorComponent implements OnInit, OnDestroy {
  stations = STATIONS;
  selectedCode = 'A01';
  predictions: any[] = [];
  loading = false;
  error = '';
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
    this.loading = true;
    this.wmata.getPredictions(this.selectedCode).subscribe({
      next: data => {
        this.predictions = data.Trains || [];
        this.loading = false;
        this.error = '';
      },
      error: err => {
        this.error = err.message;
        this.loading = false;
      }
    });
  }

  onStationChange() {
    this.predictions = [];
    this.load();
  }

  minuteClass(min: string): string {
    if (min === 'ARR') return 'arr';
    if (min === 'BRD') return 'brd';
    const n = parseInt(min, 10);
    if (isNaN(n)) return '';
    return n <= 2 ? 'soon' : '';
  }
}
