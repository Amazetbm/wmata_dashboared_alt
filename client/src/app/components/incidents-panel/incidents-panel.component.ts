import { Component, OnInit, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WmataService } from '../../services/wmata.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer, EMPTY } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

@Component({
  selector: 'app-incidents-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './incidents-panel.component.html',
  styleUrl: './incidents-panel.component.scss'
})
export class IncidentsPanelComponent implements OnInit {
  incidents = signal<any[]>([]);
  loading = signal(true);
  error = signal('');
  private destroyRef = inject(DestroyRef);

  constructor(private wmata: WmataService) {}

  ngOnInit() {
    timer(0, 30_000).pipe(
      switchMap(() => this.wmata.getLiveIncidents().pipe(
        catchError(err => { this.error.set(err.message); this.loading.set(false); return EMPTY; })
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(data => {
      this.incidents.set(data.Incidents || []);
      this.loading.set(false);
      this.error.set('');
    });
  }
}
