import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IncidentsPanelComponent } from '../incidents-panel/incidents-panel.component';
import { TrainPositionsPanelComponent } from '../train-positions-panel/train-positions-panel.component';
import { StationMonitorComponent } from '../station-monitor/station-monitor.component';
import { HistoricalViewComponent } from '../historical-view/historical-view.component';
import { AdherencePanelComponent } from '../adherence-panel/adherence-panel.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    IncidentsPanelComponent,
    TrainPositionsPanelComponent,
    StationMonitorComponent,
    HistoricalViewComponent,
    AdherencePanelComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {}
