import { Component, AfterViewInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';

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

@Component({
  selector: 'app-bus-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bus-map.component.html',
  styleUrl: './bus-map.component.scss',
})
export class BusMapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef<HTMLDivElement>;

  loading = true;
  error = '';
  busData: any = null;
  searchInput = '';
  searchedRouteId: string | null = null;
  highlightedIncidentId: string | null = null;

  private map!: L.Map;

  // Static layers — built once on first load, new routes appended on refresh
  private routeLayer = L.layerGroup();
  private stopLayer = L.layerGroup();

  // Dynamic layers — cleared and rebuilt on each refresh
  private busCluster!: InstanceType<typeof L.MarkerClusterGroup>;
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

  // ── Map init ────────────────────────────────────────────────────────────────

  private initMap(): void {
    this.map = L.map(this.mapContainer.nativeElement, { zoomControl: true })
      .setView([38.9072, -77.0369], 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    // Bus cluster group — handles clustering at low zoom levels
    this.busCluster = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 60,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: (cluster) => {
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
}
