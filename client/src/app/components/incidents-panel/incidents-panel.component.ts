import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WmataService } from '../../services/wmata.service';

@Component({
  selector: 'app-incidents-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './incidents-panel.component.html',
  styleUrl: './incidents-panel.component.scss'
})
export class IncidentsPanelComponent implements OnInit, OnDestroy {
  incidents: any[] = [];
  loading = true;
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
    this.wmata.getLiveIncidents().subscribe({
      next: data => {
        this.incidents = data.Incidents || [];
        this.loading = false;
        this.error = '';
      },
      error: err => {
        this.error = err.message;
        this.loading = false;
      }
    });
  }
}
