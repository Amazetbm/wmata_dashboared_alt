import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IncidentsPanelComponent } from '../incidents-panel/incidents-panel.component';
import { TrainPositionsPanelComponent } from '../train-positions-panel/train-positions-panel.component';
import { StationMonitorComponent } from '../station-monitor/station-monitor.component';
import { HistoricalViewComponent } from '../historical-view/historical-view.component';
import { AdherencePanelComponent } from '../adherence-panel/adherence-panel.component';
import { OutagePanelComponent } from '../outage-panel/outage-panel.component';
import { MapPanelComponent } from '../map-panel/map-panel.component';
import { ServiceHealthScorecardComponent } from '../service-health-scorecard/service-health-scorecard.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MapPanelComponent,
    IncidentsPanelComponent,
    TrainPositionsPanelComponent,
    StationMonitorComponent,
    HistoricalViewComponent,
    AdherencePanelComponent,
    OutagePanelComponent,
    ServiceHealthScorecardComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent {}
