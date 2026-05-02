import { Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard.component';

export const routes: Routes = [
  { path: '', redirectTo: 'rail', pathMatch: 'full' },
  { path: 'rail', component: DashboardComponent },
  {
    path: 'bus',
    loadComponent: () =>
      import('./components/bus-map/bus-map.component').then(m => m.BusMapComponent),
  },
  { path: '**', redirectTo: 'rail' },
];
