import { Component, OnInit, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer, EMPTY } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

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
export class TrainPositionsPanelComponent implements OnInit {
  allTrains = signal<any[]>([]);
  filtered = signal<any[]>([]);
  loading = signal(true);
  error = signal('');
  selectedLine = '';
  lines = ['', 'RD', 'BL', 'YL', 'OR', 'GR', 'SV'];
  lineColors = LINE_COLORS;
  private destroyRef = inject(DestroyRef);

  constructor(private wmata: WmataService) {}

  ngOnInit() {
    timer(0, 30_000).pipe(
      switchMap(() => this.wmata.getLocatedTrains(this.selectedLine || undefined).pipe(
        catchError(err => { this.error.set(err.message); this.loading.set(false); return EMPTY; })
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(data => {
      this.allTrains.set(data.trains || []);
      this.applyFilter();
      this.loading.set(false);
      this.error.set('');
    });
  }

  applyFilter() {
    this.filtered.set(this.selectedLine
      ? this.allTrains().filter(t => t.lineCode === this.selectedLine)
      : this.allTrains());
  }

  onLineChange() {
    this.applyFilter();
  }

  colorFor(line: string): string {
    return this.lineColors[line] || '#888';
  }

  get hasOccupancy(): boolean {
    return this.filtered().some(t => t.occupancy != null);
  }

  occupancyClass(occ: any): string {
    if (occ == null) return 'occ-null';
    switch (occ.status) {
      case 1: return 'occ-many';
      case 2: return 'occ-few';
      case 5: return 'occ-full';
      default: return 'occ-null';
    }
  }
}
