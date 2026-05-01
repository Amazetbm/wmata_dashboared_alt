import { Component, AfterViewInit, OnDestroy, ElementRef, ViewChild, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { WmataService } from '../../services/wmata.service';

// Deterministic color per route ID — keeps colors stable across refreshes
const BUS_ROUTE_PALETTE = [
  '#4299E1', '#48BB78', '#ED8936', '#9F7AEA',
  '#F56565', '#38B2AC', '#ED64A6', '#ECC94B',
  '#667EEA', '#FC8181', '#68D391', '#F6AD55',
];

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

@Component({
  selector: 'app-bus-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bus-map.component.html',
  styleUrl: './bus-map.component.scss',
})
export class BusMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('incidentSidebar') incidentSidebarRef!: ElementRef<HTMLElement>;

  // Called by the parent when this tab becomes visible so Leaflet can recalculate size.
  @Input() set active(val: boolean) {
    if (val && this.map) {
      setTimeout(() => this.map.invalidateSize(), 0);
    }
  }

  loading = true;
  error = '';
  busData: any = null;
  searchInput = '';

  // Sidebar state
  highlightedIncidentId: string | null = null;

  private map!: L.Map;

  // Static layers (built once, not rebuilt on refresh)
  private routeLayer = L.layerGroup();
  private stopLayer = L.layerGroup();

  // Dynamic layers (rebuilt on every refresh)
  private busLayer = L.layerGroup();
  private incidentHighlightLayer = L.layerGroup();

  // Search highlight — not in layer control
  private searchHighlightLayer = L.layerGroup();

  // Route shapes drawn so far: routeId → [polyline, ...] (shape0 + shape1)
  private drawnRoutePolylines = new Map<string, L.Polyline[]>();

  // Current incident route ids — rebuilt on each refresh
  private incidentRouteIds = new Set<string>();

  // Whether user has the stops overlay enabled in the layer control
  private stopsUserEnabled = true;

  searchedRouteId: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private wmata: WmataService) {}

  ngAfterViewInit(): void {
    this.initMap();
    this.fetchAndRender();
    this.refreshTimer = setInterval(() => this.fetchAndRefreshDynamic(), 30_000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.map) this.map.remove();
  }

  // ── Map initialization ──────────────────────────────────────────────────────

  private initMap(): void {
    this.map = L.map(this.mapContainer.nativeElement, { zoomControl: true })
      .setView([38.9072, -77.0369], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    // Add all layers to the map (stopLayer is always present; opacity toggled by zoom)
    this.routeLayer.addTo(this.map);
    this.stopLayer.addTo(this.map);
    this.searchHighlightLayer.addTo(this.map);
    this.incidentHighlightLayer.addTo(this.map);
    this.busLayer.addTo(this.map);

    L.control.layers(
      undefined,
      {
        'Route Polylines': this.routeLayer,
        'Bus Positions': this.busLayer,
        'Bus Stops': this.stopLayer,
        'Incident Highlights': this.incidentHighlightLayer,
      },
      { position: 'topright', collapsed: false }
    ).addTo(this.map);

    // Track layer control toggles for stops so zoom handler can respect user intent
    this.map.on('overlayadd', (e: L.LayersControlEvent) => {
      if (e.name === 'Bus Stops') { this.stopsUserEnabled = true; this.updateStopVisibility(); }
    });
    this.map.on('overlayremove', (e: L.LayersControlEvent) => {
      if (e.name === 'Bus Stops') { this.stopsUserEnabled = false; this.updateStopVisibility(); }
    });

    this.map.on('zoomend', () => this.updateStopVisibility());
  }

  // Stops use opacity toggling rather than add/remove so the layer control state
  // stays consistent across zoom changes.
  private updateStopVisibility(): void {
    const show = this.stopsUserEnabled && this.map.getZoom() >= 14;
    this.stopLayer.eachLayer((layer) => {
      (layer as L.CircleMarker).setStyle({
        opacity: show ? 0.8 : 0,
        fillOpacity: show ? 0.6 : 0,
      });
    });
  }

  // ── Data fetching ───────────────────────────────────────────────────────────

  private fetchAndRender(): void {
    this.wmata.getBusMapData().subscribe({
      next: (data) => {
        this.busData = data;
        this.loading = false;
        this.error = '';
        this.rebuildRoutePolylines();
        this.rebuildStops();
        this.rebuildIncidentHighlights(); // populate incidentRouteIds first
        this.rebuildBuses();              // so bus marker colors reflect incident state
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
        // Add shapes for any newly active routes not yet drawn
        this.addNewRoutePolylines(data.routeShapes || {});
        this.rebuildIncidentHighlights();
        this.rebuildBuses();
      },
      error: (err) => console.error('[bus-map refresh]', err),
    });
  }

  // ── Route polylines ─────────────────────────────────────────────────────────

  private rebuildRoutePolylines(): void {
    this.routeLayer.clearLayers();
    this.drawnRoutePolylines.clear();
    const shapes: Record<string, { shape0: [number, number][]; shape1: [number, number][] }> =
      this.busData.routeShapes || {};
    for (const [routeId, detail] of Object.entries(shapes)) {
      this.drawRoutePolylines(routeId, detail);
    }
  }

  private addNewRoutePolylines(
    shapes: Record<string, { shape0: [number, number][]; shape1: [number, number][] }>
  ): void {
    for (const [routeId, detail] of Object.entries(shapes)) {
      if (!this.drawnRoutePolylines.has(routeId)) {
        this.drawRoutePolylines(routeId, detail);
      }
    }
  }

  private drawRoutePolylines(
    routeId: string,
    detail: { shape0: [number, number][]; shape1: [number, number][] }
  ): void {
    const lines: L.Polyline[] = [];
    for (const coords of [detail.shape0, detail.shape1]) {
      if (!coords?.length) continue;
      const pl = L.polyline(coords as L.LatLngExpression[], {
        color: '#6c7086',
        weight: 2,
        opacity: 0.65,
      });
      pl.addTo(this.routeLayer);
      lines.push(pl);
    }
    if (lines.length) this.drawnRoutePolylines.set(routeId, lines);
  }

  // ── Bus stops ───────────────────────────────────────────────────────────────

  private rebuildStops(): void {
    this.stopLayer.clearLayers();
    const stops: any[] = this.busData.stops || [];
    for (const stop of stops) {
      if (!stop.Lat || !stop.Lon) continue;
      const marker = L.circleMarker([stop.Lat, stop.Lon] as L.LatLngExpression, {
        radius: 3,
        color: '#45475a',
        weight: 1,
        fillColor: '#7f849c',
        fillOpacity: 0,  // updateStopVisibility() sets correct opacity after all stops are added
        opacity: 0,
      });
      marker.bindPopup(() => this.buildStopPopup(stop), { maxWidth: 220 });
      marker.addTo(this.stopLayer);
    }
    // Stops start hidden until zoom >= 14
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
      const routes = document.createElement('div');
      routes.className = 'map-popup-lines';
      for (const r of (stop.Routes as string[]).slice(0, 8)) {
        const chip = document.createElement('span');
        chip.className = 'map-line-chip';
        chip.style.background = getBusRouteColor(r);
        chip.style.color = '#11111b';
        chip.textContent = r;
        routes.appendChild(chip);
      }
      if (stop.Routes.length > 8) {
        const more = document.createElement('span');
        more.className = 'map-popup-detail';
        more.textContent = `+${stop.Routes.length - 8} more`;
        routes.appendChild(more);
      }
      root.appendChild(routes);
    }

    return root;
  }

  // ── Bus position markers ────────────────────────────────────────────────────

  private rebuildBuses(): void {
    this.busLayer.clearLayers();
    const positions: any[] = this.busData.positions || [];
    const filterRouteId = this.searchedRouteId;

    for (const bus of positions) {
      if (!bus.Lat || !bus.Lon) continue;
      if (filterRouteId && bus.RouteID !== filterRouteId) continue;

      const color = getBusRouteColor(bus.RouteID || '');
      const hasIncident = this.incidentRouteIds.has(bus.RouteID || '');

      const marker = L.circleMarker([bus.Lat, bus.Lon] as L.LatLngExpression, {
        radius: 5,
        color: hasIncident ? '#F59E0B' : color,
        weight: hasIncident ? 2.5 : 1.5,
        fillColor: color,
        fillOpacity: 0.9,
      });

      marker.bindPopup(() => this.buildBusPopup(bus, color), { maxWidth: 240 });

      // Clicking a bus with an active incident scrolls sidebar to that incident
      if (hasIncident) {
        marker.on('click', () => {
          const incident = this.findIncidentForRoute(bus.RouteID);
          if (incident) this.activateIncidentInSidebar(incident.IncidentID);
        });
      }

      marker.addTo(this.busLayer);
    }
  }

  private buildBusPopup(bus: any, color: string): HTMLElement {
    const root = document.createElement('div');
    root.className = 'map-popup';

    const title = document.createElement('div');
    title.className = 'map-popup-title';
    title.textContent = `Bus ${bus.VehicleID || '—'}`;
    root.appendChild(title);

    const routeDiv = document.createElement('div');
    routeDiv.className = 'map-popup-lines';
    const chip = document.createElement('span');
    chip.className = 'map-line-chip';
    chip.style.background = color;
    chip.style.color = '#11111b';
    chip.textContent = bus.RouteID || '?';
    routeDiv.appendChild(chip);
    root.appendChild(routeDiv);

    const details: [string, string][] = [
      ['Destination', bus.TripHeadsign || '—'],
      ['Deviation', formatDeviation(bus.Deviation)],
      ['Last updated', bus.DateTime ? new Date(bus.DateTime).toLocaleTimeString() : '—'],
    ];
    for (const [label, value] of details) {
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

  // ── Incident highlights ─────────────────────────────────────────────────────

  private rebuildIncidentHighlights(): void {
    this.incidentHighlightLayer.clearLayers();
    this.incidentRouteIds.clear();

    const incidents: any[] = this.busData.incidents || [];
    for (const inc of incidents) {
      for (const routeId of (inc.RoutesAffected || []) as string[]) {
        this.incidentRouteIds.add(routeId);
      }
    }

    // Draw amber polylines on top of gray route polylines for incident routes
    for (const routeId of this.incidentRouteIds) {
      const shapes = this.busData.routeShapes?.[routeId];
      if (!shapes) continue;
      for (const coords of [shapes.shape0, shapes.shape1] as [number, number][][]) {
        if (!coords?.length) continue;
        L.polyline(coords as L.LatLngExpression[], {
          color: '#F59E0B',
          weight: 3,
          opacity: 0.85,
        }).addTo(this.incidentHighlightLayer);
      }
    }

    // Pulsing rings at bus positions for buses on incident routes
    const positions: any[] = this.busData.positions || [];
    for (const bus of positions) {
      if (!this.incidentRouteIds.has(bus.RouteID || '')) continue;
      if (!bus.Lat || !bus.Lon) continue;

      const icon = L.divIcon({
        className: '',
        html: '<div class="pulse-ring bus-pulse-ring"></div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      L.marker([bus.Lat, bus.Lon] as L.LatLngExpression, {
        icon,
        interactive: false,
        zIndexOffset: -100,
      }).addTo(this.incidentHighlightLayer);
    }
  }

  // ── Route search ────────────────────────────────────────────────────────────

  onSearchChange(): void {
    const q = this.searchInput.trim().toLowerCase();
    if (!q) {
      this.clearSearch();
      return;
    }

    const routes: any[] = this.busData?.routes || [];
    const match = routes.find(
      r => r.RouteID?.toLowerCase() === q || r.Name?.toLowerCase().includes(q)
    );

    if (!match) {
      this.searchHighlightLayer.clearLayers();
      this.searchedRouteId = null;
      this.rebuildBuses();
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
    if (!shapes) {
      this.rebuildBuses();
      return;
    }

    const allCoords: L.LatLngExpression[] = [];
    for (const coords of [shapes.shape0, shapes.shape1] as [number, number][][]) {
      if (!coords?.length) continue;
      const pl = L.polyline(coords as L.LatLngExpression[], {
        color: '#3B82F6',
        weight: 4,
        opacity: 0.95,
      });
      pl.addTo(this.searchHighlightLayer);
      allCoords.push(...(coords as L.LatLngExpression[]));
    }

    if (allCoords.length) {
      this.map.fitBounds(L.latLngBounds(allCoords), { padding: [40, 40] });
    }

    this.rebuildBuses();
  }

  // ── Incident sidebar ────────────────────────────────────────────────────────

  onIncidentClick(incident: any): void {
    this.activateIncidentInSidebar(incident.IncidentID);
    this.highlightIncidentRoute(incident);
  }

  private activateIncidentInSidebar(incidentId: string): void {
    this.highlightedIncidentId = incidentId;
    setTimeout(() => {
      const el = document.getElementById(`incident-${incidentId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  }

  private highlightIncidentRoute(incident: any): void {
    const routes: string[] = incident.RoutesAffected || [];
    if (!routes.length) return;

    const routeId = routes.find(r => this.busData?.routeShapes?.[r]);
    if (!routeId) return;

    // Draw blue highlight and fit bounds — do NOT filter buses (that's the search box's job)
    this.searchHighlightLayer.clearLayers();
    const shapes = this.busData.routeShapes[routeId];
    const allCoords: L.LatLngExpression[] = [];

    for (const coords of [shapes.shape0, shapes.shape1] as [number, number][][]) {
      if (!coords?.length) continue;
      L.polyline(coords as L.LatLngExpression[], { color: '#3B82F6', weight: 4, opacity: 0.95 })
        .addTo(this.searchHighlightLayer);
      allCoords.push(...(coords as L.LatLngExpression[]));
    }

    if (allCoords.length) {
      this.map.fitBounds(L.latLngBounds(allCoords), { padding: [40, 40] });
    }
  }

  private findIncidentForRoute(routeId: string): any | null {
    const incidents: any[] = this.busData?.incidents || [];
    return incidents.find(i => (i.RoutesAffected || []).includes(routeId)) ?? null;
  }
}
