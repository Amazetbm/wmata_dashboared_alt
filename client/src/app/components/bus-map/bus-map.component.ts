import { Component, AfterViewInit, OnDestroy, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';
import Chart from 'chart.js/auto';

// Use require() for both leaflet and markercluster so they resolve to the same CJS
// module instance. Angular's esbuild builder resolves `import * as L from 'leaflet'`
// to leaflet's ESM build, while markercluster's UMD factory calls require('leaflet')
// and gets the CJS build — two separate instances, so the extension never lands on L.
// Declaring require here avoids needing @types/node in the project.
declare var require: (id: string) => any; // eslint-disable-line no-var
const L = require('leaflet') as typeof import('leaflet');
require('leaflet.markercluster');

// Deterministic color per route ID — stable across refreshes
const BUS_ROUTE_PALETTE = [
  '#4299E1', '#48BB78', '#ED8936', '#9F7AEA',
  '#F56565', '#38B2AC', '#ED64A6', '#ECC94B',
  '#667EEA', '#FC8181', '#68D391', '#F6AD55',
];

const HIST_TYPE_COLORS: Record<string, string> = {
  Alert:      '#F59E0B',
  Delay:      '#F56565',
  Planned:    '#68D391',
  Special:    '#9F7AEA',
  Suspension: '#4299E1',
};

function getBusRouteColor(routeId: string): string {
  let hash = 0;
  for (let i = 0; i < routeId.length; i++) {
    hash = (hash * 31 + routeId.charCodeAt(i)) & 0x7fffffff;
  }
  return BUS_ROUTE_PALETTE[hash % BUS_ROUTE_PALETTE.length];
}

function formatDeviation(dev: number | null | undefined): string {
  if (dev == null) return '—';
  if (dev === 0) return 'On time';
  const abs = Math.abs(dev);
  return dev > 0 ? `${abs} min late` : `${abs} min early`;
}

// L.marker with a circle divIcon so markerClusterGroup can cluster it.
// L.circleMarker extends L.Path and is not compatible with markerClusterGroup.
function createBusDivMarker(
  lat: number, lon: number, color: string, hasIncident: boolean
): L.Marker {
  const border = hasIncident ? '#F59E0B' : 'rgba(255,255,255,0.45)';
  const weight = hasIncident ? '2' : '1.5';
  const icon = L.divIcon({
    className: '',
    html: `<div style="
      width:10px;height:10px;border-radius:50%;
      background:${color};
      border:${weight}px solid ${border};
      box-sizing:border-box;
      box-shadow:0 1px 3px rgba(0,0,0,0.35);
    "></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
  return L.marker([lat, lon], { icon });
}

// ── Historical data interfaces ────────────────────────────────────────────────

interface HistSummary {
  total: number;
  mostAffectedRoute: string | null;
  mostCommonType: string | null;
  avgDaily: number;
}

interface HistDailyEntry {
  date: string;
  types: Record<string, number>;
}

interface HistRouteEntry {
  route: string;
  count: number;
}

interface HistIncident {
  incidentId: string;
  description: string;
  type: string;
  routes: string[];
  firstSeen: string;
  lastSeen: string;
  durationMinutes: number;
}

interface HistData {
  dailyByType: HistDailyEntry[];
  topRoutes: HistRouteEntry[];
  incidents: HistIncident[];
  summary: HistSummary;
}

@Component({
  selector: 'app-bus-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bus-map.component.html',
  styleUrl: './bus-map.component.scss',
})
export class BusMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer')    mapContainer!:    ElementRef<HTMLDivElement>;
  @ViewChild('dailyChartCanvas') dailyChartCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('routeChartCanvas') routeChartCanvas!: ElementRef<HTMLCanvasElement>;

  loading = true;
  error = '';
  busData: any = null;
  searchInput = '';
  searchedRouteId: string | null = null;
  highlightedIncidentId: string | null = null;

  // ── Historical section state ─────────────────────────────────────────────
  histPreset: '24h' | '7d' | '30d' | 'custom' = '7d';
  histDateFrom = '';
  histDateTo = '';
  histRouteFilter = '';
  histLoading = false;
  histError = '';
  histData: HistData | null = null;
  histDrillDate: string | null = null;
  histFilteredRoute: string | null = null;

  private map!: L.Map;

  // Static layers — built once on first load, new routes appended on refresh
  private routeLayer = L.layerGroup();
  private stopLayer = L.layerGroup();

  // Dynamic layers — cleared and rebuilt on each refresh
  private busCluster!: any;
  private incidentHighlightLayer = L.layerGroup();

  // Search highlight — not in layer control, cleared on new search or clear
  private searchHighlightLayer = L.layerGroup();

  // Tracks which route IDs have already been drawn to routeLayer
  private drawnRouteIds = new Set<string>();

  // Route IDs with active incidents — rebuilt in rebuildIncidentHighlights()
  private incidentRouteIds = new Set<string>();

  // Whether the user has stops enabled in the layer control
  private stopsUserEnabled = true;

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  private dailyChart: Chart | null = null;
  private routeChart: Chart | null = null;

  constructor(private wmata: WmataService, private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.initMap();
    this.fetchAndRender();
    this.refreshTimer = setInterval(() => this.fetchAndRefreshDynamic(), 30_000);
    this.fetchHistory();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.map) this.map.remove();
    this.dailyChart?.destroy();
    this.routeChart?.destroy();
  }

  // ── Map init ────────────────────────────────────────────────────────────────

  private initMap(): void {
    this.map = L.map(this.mapContainer.nativeElement, { zoomControl: true })
      .setView([38.9072, -77.0369], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    // Bus cluster group — handles clustering at low zoom levels
    this.busCluster = (L as any).markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 60,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: (cluster: any) => {
        const n = cluster.getChildCount();
        const size = n < 10 ? 30 : n < 50 ? 36 : 44;
        return L.divIcon({
          className: '',
          html: `<div class="bus-cluster-icon" style="width:${size}px;height:${size}px">${n}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
      },
    });

    // Layer order matters — stops and routes below buses and highlights
    this.routeLayer.addTo(this.map);
    this.stopLayer.addTo(this.map);
    this.searchHighlightLayer.addTo(this.map);
    this.incidentHighlightLayer.addTo(this.map);
    this.busCluster.addTo(this.map);

    L.control.layers(
      undefined,
      {
        'Route Polylines': this.routeLayer,
        'Bus Positions': this.busCluster,
        'Bus Stops': this.stopLayer,
        'Incident Highlights': this.incidentHighlightLayer,
      },
      { position: 'topright', collapsed: false }
    ).addTo(this.map);

    // Stop visibility: opacity toggled on zoomend (zoom ≥ 14 to show)
    this.map.on('overlayadd', (e: L.LayersControlEvent) => {
      if (e.name === 'Bus Stops') { this.stopsUserEnabled = true; this.updateStopVisibility(); }
    });
    this.map.on('overlayremove', (e: L.LayersControlEvent) => {
      if (e.name === 'Bus Stops') { this.stopsUserEnabled = false; this.updateStopVisibility(); }
    });
    this.map.on('zoomend', () => this.updateStopVisibility());
  }

  // Stops are always in the layer but rendered invisible below zoom 14.
  // Using opacity rather than add/remove keeps the layer control checkbox consistent.
  private updateStopVisibility(): void {
    const show = this.stopsUserEnabled && this.map.getZoom() >= 14;
    this.stopLayer.eachLayer((layer) => {
      (layer as L.CircleMarker).setStyle({
        opacity: show ? 0.8 : 0,
        fillOpacity: show ? 0.6 : 0,
      });
    });
  }

  // ── Data fetching ────────────────────────────────────────────────────────────

  private fetchAndRender(): void {
    this.wmata.getBusMapData().subscribe({
      next: (data) => {
        this.busData = data;
        this.loading = false;
        this.error = '';
        this.rebuildRoutePolylines();
        this.rebuildStops();
        this.rebuildIncidentHighlights(); // populate incidentRouteIds before rebuildBuses
        this.rebuildBuses();
      },
      error: (err) => {
        this.loading = false;
        this.error = 'Failed to load bus map data.';
        console.error('[bus-map]', err);
      },
    });
  }

  private fetchAndRefreshDynamic(): void {
    this.wmata.getBusMapData().subscribe({
      next: (data) => {
        this.busData = data;
        this.error = '';
        this.addNewRoutePolylines(data.routeShapes || {});
        this.rebuildIncidentHighlights();
        this.rebuildBuses();
      },
      error: (err) => console.error('[bus-map refresh]', err),
    });
  }

  // ── Route polylines ──────────────────────────────────────────────────────────

  private rebuildRoutePolylines(): void {
    this.routeLayer.clearLayers();
    this.drawnRouteIds.clear();
    this.addNewRoutePolylines(this.busData.routeShapes || {});
  }

  private addNewRoutePolylines(
    shapes: Record<string, { shape0: [number, number][]; shape1: [number, number][] }>
  ): void {
    for (const [routeId, detail] of Object.entries(shapes)) {
      if (this.drawnRouteIds.has(routeId)) continue;
      this.drawnRouteIds.add(routeId);
      for (const coords of [detail.shape0, detail.shape1]) {
        if (!coords?.length) continue;
        L.polyline(coords as L.LatLngExpression[], {
          color: '#6c7086',
          weight: 2,
          opacity: 0.65,
        }).addTo(this.routeLayer);
      }
    }
  }

  // ── Bus stops ────────────────────────────────────────────────────────────────

  private rebuildStops(): void {
    this.stopLayer.clearLayers();
    for (const stop of (this.busData.stops || []) as any[]) {
      if (!stop.Lat || !stop.Lon) continue;
      const marker = L.circleMarker([stop.Lat, stop.Lon] as L.LatLngExpression, {
        radius: 3,
        color: '#45475a',
        weight: 1,
        fillColor: '#7f849c',
        fillOpacity: 0, // starts hidden; updateStopVisibility() applies correct state
        opacity: 0,
      });
      marker.bindPopup(() => this.buildStopPopup(stop), { maxWidth: 220 });
      marker.addTo(this.stopLayer);
    }
    this.updateStopVisibility();
  }

  private buildStopPopup(stop: any): HTMLElement {
    const root = document.createElement('div');
    root.className = 'map-popup';
    const title = document.createElement('div');
    title.className = 'map-popup-title';
    title.textContent = stop.Name || stop.StopID || 'Bus Stop';
    root.appendChild(title);
    if (stop.Routes?.length) {
      const row = document.createElement('div');
      row.className = 'map-popup-lines';
      for (const r of (stop.Routes as string[]).slice(0, 8)) {
        const chip = document.createElement('span');
        chip.className = 'map-line-chip';
        chip.style.background = getBusRouteColor(r);
        chip.style.color = '#11111b';
        chip.textContent = r;
        row.appendChild(chip);
      }
      if (stop.Routes.length > 8) {
        const more = document.createElement('span');
        more.className = 'map-popup-detail';
        more.textContent = `+${stop.Routes.length - 8} more`;
        row.appendChild(more);
      }
      root.appendChild(row);
    }
    return root;
  }

  // ── Bus markers (clustered) ──────────────────────────────────────────────────

  private rebuildBuses(): void {
    this.busCluster.clearLayers();
    const filterRouteId = this.searchedRouteId;

    for (const bus of (this.busData.positions || []) as any[]) {
      if (!bus.Lat || !bus.Lon) continue;
      if (filterRouteId && bus.RouteID !== filterRouteId) continue;

      const color = getBusRouteColor(bus.RouteID || '');
      const hasIncident = this.incidentRouteIds.has(bus.RouteID || '');
      const marker = createBusDivMarker(bus.Lat, bus.Lon, color, hasIncident);

      marker.bindPopup(() => this.buildBusPopup(bus, color), { maxWidth: 240 });

      if (hasIncident) {
        marker.on('click', () => {
          const inc = this.findIncidentForRoute(bus.RouteID);
          if (inc) this.activateIncidentInSidebar(inc.IncidentID);
        });
      }

      this.busCluster.addLayer(marker);
    }
  }

  private buildBusPopup(bus: any, color: string): HTMLElement {
    const root = document.createElement('div');
    root.className = 'map-popup';
    const title = document.createElement('div');
    title.className = 'map-popup-title';
    title.textContent = `Bus ${bus.VehicleID || '—'}`;
    root.appendChild(title);
    const routeRow = document.createElement('div');
    routeRow.className = 'map-popup-lines';
    const chip = document.createElement('span');
    chip.className = 'map-line-chip';
    chip.style.background = color;
    chip.style.color = '#11111b';
    chip.textContent = bus.RouteID || '?';
    routeRow.appendChild(chip);
    root.appendChild(routeRow);
    for (const [label, value] of [
      ['Destination', bus.TripHeadsign || '—'],
      ['Deviation', formatDeviation(bus.Deviation)],
      ['Last updated', bus.DateTime ? new Date(bus.DateTime).toLocaleTimeString() : '—'],
    ] as [string, string][]) {
      const row = document.createElement('div');
      row.className = 'map-popup-detail';
      const strong = document.createElement('strong');
      strong.textContent = label + ': ';
      row.appendChild(strong);
      row.appendChild(document.createTextNode(value));
      root.appendChild(row);
    }
    return root;
  }

  // ── Incident highlights ──────────────────────────────────────────────────────

  private rebuildIncidentHighlights(): void {
    this.incidentHighlightLayer.clearLayers();
    this.incidentRouteIds.clear();

    for (const inc of (this.busData.incidents || []) as any[]) {
      for (const r of (inc.RoutesAffected || []) as string[]) {
        this.incidentRouteIds.add(r);
      }
    }

    // Amber polylines over incident routes
    for (const routeId of this.incidentRouteIds) {
      const shapes = this.busData.routeShapes?.[routeId];
      if (!shapes) continue;
      for (const coords of [shapes.shape0, shapes.shape1] as [number, number][][]) {
        if (!coords?.length) continue;
        L.polyline(coords as L.LatLngExpression[], {
          color: '#F59E0B', weight: 3, opacity: 0.85,
        }).addTo(this.incidentHighlightLayer);
      }
    }

    // Pulsing rings at individual bus positions on incident routes
    for (const bus of (this.busData.positions || []) as any[]) {
      if (!this.incidentRouteIds.has(bus.RouteID || '') || !bus.Lat || !bus.Lon) continue;
      L.marker([bus.Lat, bus.Lon] as L.LatLngExpression, {
        icon: L.divIcon({
          className: '',
          html: '<div class="pulse-ring bus-pulse-ring"></div>',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        interactive: false,
        zIndexOffset: -100,
      }).addTo(this.incidentHighlightLayer);
    }
  }

  // ── Route search ─────────────────────────────────────────────────────────────

  onSearchChange(): void {
    const q = this.searchInput.trim().toLowerCase();
    if (!q) { this.clearSearch(); return; }

    const match = (this.busData?.routes || []).find(
      (r: any) => r.RouteID?.toLowerCase() === q || r.Name?.toLowerCase().includes(q)
    );

    if (!match) {
      this.searchHighlightLayer.clearLayers();
      this.searchedRouteId = null;
      if (this.busData) this.rebuildBuses();
      return;
    }

    this.applyRouteSearch(match.RouteID);
  }

  clearSearch(): void {
    this.searchInput = '';
    this.searchHighlightLayer.clearLayers();
    this.searchedRouteId = null;
    if (this.busData) this.rebuildBuses();
  }

  private applyRouteSearch(routeId: string): void {
    this.searchedRouteId = routeId;
    this.searchHighlightLayer.clearLayers();

    const shapes = this.busData?.routeShapes?.[routeId];
    if (!shapes) { this.rebuildBuses(); return; }

    const all: L.LatLngExpression[] = [];
    for (const coords of [shapes.shape0, shapes.shape1] as [number, number][][]) {
      if (!coords?.length) continue;
      L.polyline(coords as L.LatLngExpression[], { color: '#3B82F6', weight: 4, opacity: 0.95 })
        .addTo(this.searchHighlightLayer);
      all.push(...(coords as L.LatLngExpression[]));
    }
    if (all.length) this.map.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
    this.rebuildBuses();
  }

  // ── Incident sidebar ─────────────────────────────────────────────────────────

  onIncidentClick(incident: any): void {
    this.activateIncidentInSidebar(incident.IncidentID);
    this.highlightIncidentRoute(incident);
  }

  private activateIncidentInSidebar(incidentId: string): void {
    this.highlightedIncidentId = incidentId;
    setTimeout(() => {
      document.getElementById(`incident-${incidentId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  }

  private highlightIncidentRoute(incident: any): void {
    const routeId = (incident.RoutesAffected || []).find(
      (r: string) => this.busData?.routeShapes?.[r]
    );
    if (!routeId) return;

    this.searchHighlightLayer.clearLayers();
    const shapes = this.busData.routeShapes[routeId];
    const all: L.LatLngExpression[] = [];
    for (const coords of [shapes.shape0, shapes.shape1] as [number, number][][]) {
      if (!coords?.length) continue;
      L.polyline(coords as L.LatLngExpression[], { color: '#3B82F6', weight: 4, opacity: 0.95 })
        .addTo(this.searchHighlightLayer);
      all.push(...(coords as L.LatLngExpression[]));
    }
    if (all.length) this.map.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
  }

  private findIncidentForRoute(routeId: string): any | null {
    return (this.busData?.incidents || []).find(
      (i: any) => (i.RoutesAffected || []).includes(routeId)
    ) ?? null;
  }

  // ── Historical section ───────────────────────────────────────────────────────

  setHistPreset(preset: '24h' | '7d' | '30d' | 'custom'): void {
    this.histPreset = preset;
    if (preset !== 'custom') this.fetchHistory();
  }

  applyCustomRange(): void {
    if (this.histDateFrom && this.histDateTo) this.fetchHistory();
  }

  fetchHistory(): void {
    const now = new Date();
    let startISO: string, endISO: string;

    if (this.histPreset === 'custom') {
      if (!this.histDateFrom || !this.histDateTo) return;
      startISO = new Date(this.histDateFrom + 'T00:00:00').toISOString();
      endISO   = new Date(this.histDateTo   + 'T23:59:59.999').toISOString();
    } else {
      const from = new Date(now);
      if (this.histPreset === '24h')      from.setDate(now.getDate() - 1);
      else if (this.histPreset === '7d')  from.setDate(now.getDate() - 7);
      else                                from.setDate(now.getDate() - 30);
      startISO = from.toISOString();
      endISO   = now.toISOString();
    }

    this.histLoading = true;
    this.histError   = '';
    this.histData    = null;
    this.histDrillDate     = null;
    this.histFilteredRoute = null;
    this.destroyCharts();

    this.wmata.getBusIncidentHistory(startISO, endISO, this.histRouteFilter || undefined)
      .subscribe({
        next: (data: HistData) => {
          this.histData    = data;
          this.histLoading = false;
          this.cdr.detectChanges(); // flush @if so canvas elements exist before renderCharts reads them
          this.renderCharts();
        },
        error: (err: any) => {
          this.histLoading = false;
          this.histError   = 'Failed to load historical incident data.';
          console.error('[bus-map hist]', err);
        },
      });
  }

  onRouteBarClick(route: string): void {
    this.histFilteredRoute = this.histFilteredRoute === route ? null : route;
    this.histDrillDate = null;

    if (this.histFilteredRoute) {
      this.mapContainer.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this.fitMapToRoute(this.histFilteredRoute);
    }

    // Update bar colors without full chart recreate
    if (this.routeChart && this.histData) {
      const ds = this.routeChart.data.datasets[0] as any;
      ds.backgroundColor = this.histData.topRoutes.map(r =>
        r.route === this.histFilteredRoute ? '#89b4fa' : '#4299E1'
      );
      this.routeChart.update();
    }
  }

  clearDrillDown(): void {
    this.histDrillDate = null;
  }

  clearRouteFilter(): void {
    this.histFilteredRoute = null;
    if (this.routeChart && this.histData) {
      const ds = this.routeChart.data.datasets[0] as any;
      ds.backgroundColor = '#4299E1';
      this.routeChart.update();
    }
  }

  getRouteColor(routeId: string): string {
    return getBusRouteColor(routeId);
  }

  getTypeColor(type: string): string {
    return HIST_TYPE_COLORS[type] || '#45475a';
  }

  get visibleIncidents(): HistIncident[] {
    if (!this.histData) return [];
    let incs = this.histData.incidents;
    if (this.histDrillDate) {
      incs = incs.filter(i => i.firstSeen.startsWith(this.histDrillDate!));
    }
    if (this.histFilteredRoute) {
      incs = incs.filter(i => i.routes.includes(this.histFilteredRoute!));
    }
    return incs;
  }

  formatDuration(minutes: number): string {
    if (minutes === 0) return '< 1 min';
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  private fitMapToRoute(routeId: string): void {
    const shapes = this.busData?.routeShapes?.[routeId];
    if (!shapes) return;
    const all: L.LatLngExpression[] = [];
    for (const coords of [shapes.shape0, shapes.shape1] as [number, number][][]) {
      if (coords?.length) all.push(...(coords as L.LatLngExpression[]));
    }
    if (all.length) this.map.fitBounds(L.latLngBounds(all), { padding: [40, 40] });
  }

  private destroyCharts(): void {
    this.dailyChart?.destroy(); this.dailyChart = null;
    this.routeChart?.destroy(); this.routeChart = null;
  }

  private renderCharts(): void {
    if (!this.histData || !this.dailyChartCanvas?.nativeElement || !this.routeChartCanvas?.nativeElement) return;
    this.destroyCharts();

    const { dailyByType, topRoutes } = this.histData;
    const dates    = dailyByType.map(d => d.date);
    const allTypes = [...new Set(dailyByType.flatMap(d => Object.keys(d.types)))];

    const dailyDatasets = allTypes.map((type, i) => ({
      label: type,
      data: dailyByType.map(d => d.types[type] || 0),
      backgroundColor: HIST_TYPE_COLORS[type] || BUS_ROUTE_PALETTE[i % BUS_ROUTE_PALETTE.length],
      stack: 'stack',
      borderRadius: 2,
    }));

    this.dailyChart = new Chart(this.dailyChartCanvas.nativeElement, {
      type: 'bar',
      data: { labels: dates, datasets: dailyDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#a6adc8', font: { size: 11 }, boxWidth: 12 } },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#6c7086', maxRotation: 45, font: { size: 10 } },
            grid:  { color: 'rgba(69,71,90,0.4)' },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { color: '#6c7086', font: { size: 10 } },
            grid:  { color: 'rgba(69,71,90,0.4)' },
          },
        },
        onClick: (_: any, elements: any[]) => {
          if (!elements.length) return;
          const date = dates[elements[0].index];
          this.histDrillDate     = this.histDrillDate === date ? null : date;
          this.histFilteredRoute = null;
        },
      },
    } as any);

    this.routeChart = new Chart(this.routeChartCanvas.nativeElement, {
      type: 'bar',
      data: {
        labels: topRoutes.map(r => r.route),
        datasets: [{
          label: 'Incidents',
          data: topRoutes.map(r => r.count),
          backgroundColor: topRoutes.map(r =>
            r.route === this.histFilteredRoute ? '#89b4fa' : '#4299E1'
          ),
          borderRadius: 3,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#6c7086', font: { size: 10 } },
            grid:  { color: 'rgba(69,71,90,0.4)' },
          },
          y: {
            ticks: { color: '#cdd6f4', font: { size: 11 } },
            grid:  { display: false },
          },
        },
        onClick: (_: any, elements: any[]) => {
          if (!elements.length) return;
          this.onRouteBarClick(topRoutes[elements[0].index].route);
        },
      },
    } as any);
  }
}
