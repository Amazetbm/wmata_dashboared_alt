import { Component, AfterViewInit, OnDestroy, ElementRef, ViewChild, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import * as L from 'leaflet';
import { WmataService } from '../../services/wmata.service';
import { MapCommandService } from '../../services/map-command.service';

const LINE_COLORS: Record<string, string> = {
  RD: '#E32726',
  BL: '#009CDE',
  OR: '#F7941D',
  GR: '#00B140',
  YL: '#FFD700',
  SV: '#9D9F9C',
};

const LINE_LABELS: Record<string, string> = {
  ALL: 'All Lines',
  RD: 'Red',
  BL: 'Blue',
  OR: 'Orange',
  GR: 'Green',
  YL: 'Yellow',
  SV: 'Silver',
};

@Component({
  selector: 'app-map-panel',
  standalone: true,
  imports: [],
  templateUrl: './map-panel.component.html',
  styleUrl: './map-panel.component.scss',
})
export class MapPanelComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer') mapContainer!: ElementRef<HTMLDivElement>;

  readonly LINES = ['ALL', 'RD', 'BL', 'OR', 'YL', 'GR', 'SV'] as const;
  readonly LINE_LABELS = LINE_LABELS;
  readonly LINE_COLORS = LINE_COLORS;

  selectedLine = 'ALL';
  loading = true;
  error = '';
  trainCount = 0;

  private map!: L.Map;
  private polylineLayer = L.layerGroup();
  private stationLayer = L.layerGroup();
  private trainLayer = L.layerGroup();
  private incidentLayer = L.layerGroup();

  // Shared incident index kept fresh by rebuildIncidents() so station popup factories read current data
  private incidentsByLine = new Map<string, any[]>();

  private cachedData: any = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private stationMarkerIndex = new Map<string, L.CircleMarker>();

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private wmata: WmataService,
    private mapCommandService: MapCommandService,
  ) {}

  ngAfterViewInit(): void {
    this.initMap();
    this.fetchAndRender();
    this.refreshTimer = setInterval(() => this.fetchAndRefreshDynamic(), 30_000);

    this.mapCommandService.stream$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(action => {
        if (action.action === 'focus_line')    this.selectLine(action.target);
        if (action.action === 'focus_station') this.panToStation(action.target);
      });
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.map) this.map.remove();
  }

  private initMap(): void {
    this.map = L.map(this.mapContainer.nativeElement, { zoomControl: true })
      .setView([38.9072, -77.0369], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    this.polylineLayer.addTo(this.map);
    this.stationLayer.addTo(this.map);
    this.trainLayer.addTo(this.map);
    this.incidentLayer.addTo(this.map);

    L.control.layers(
      undefined,
      {
        'Train Positions': this.trainLayer,
        'Stations': this.stationLayer,
        'Incident Highlights': this.incidentLayer,
      },
      { position: 'topright', collapsed: false }
    ).addTo(this.map);
  }

  private fetchAndRender(): void {
    this.wmata.getMapData().subscribe({
      next: (data) => {
        this.cachedData = data;
        this.loading = false;
        this.error = '';
        this.trainCount = data.trains?.length ?? 0;
        this.rebuildAll();
      },
      error: (err) => {
        this.loading = false;
        this.error = 'Failed to load map data.';
        console.error('[map-panel]', err);
      },
    });
  }

  // On each 30 s tick: only rebuild dynamic layers (trains + incidents).
  // Polylines and station markers are stable — no need to re-create them.
  private fetchAndRefreshDynamic(): void {
    this.wmata.getMapData().subscribe({
      next: (data) => {
        this.cachedData = data;
        this.error = '';
        this.trainCount = data.trains?.length ?? 0;
        this.rebuildIncidents(); // updates incidentsByLine index first
        this.rebuildTrains();
      },
      error: (err) => console.error('[map-panel refresh]', err),
    });
  }

  selectLine(line: string): void {
    this.selectedLine = line;
    if (this.cachedData) this.rebuildAll();
  }

  panToStation(stationCode: string): void {
    if (!this.cachedData?.stations || !this.map) return;
    const station = (this.cachedData.stations as any[]).find(
      s => s.code === stationCode.toUpperCase()
    );
    if (!station) return;
    this.map.setView([station.lat, station.lon], 14, { animate: true });
    const marker = this.stationMarkerIndex.get(stationCode.toUpperCase());
    if (marker) marker.openPopup();
  }

  private rebuildAll(): void {
    this.rebuildPolylines();
    this.rebuildStations();
    this.rebuildIncidents();
    this.rebuildTrains();
  }

  // ── Polylines ─────────────────────────────────────────────────────────────

  private rebuildPolylines(): void {
    this.polylineLayer.clearLayers();
    const routes = this.cachedData.routes as Record<string, [number, number][]>;
    const linesToDraw = this.selectedLine === 'ALL' ? Object.keys(routes) : [this.selectedLine];

    for (const line of linesToDraw) {
      const coords = routes[line];
      if (!coords?.length) continue;
      L.polyline(coords, {
        color: LINE_COLORS[line] ?? '#888',
        weight: 4,
        opacity: 0.85,
      }).addTo(this.polylineLayer);
    }
  }

  // ── Stations ───────────────────────────────────────────────────────────────

  private rebuildStations(): void {
    this.stationLayer.clearLayers();
    this.stationMarkerIndex.clear();
    const { stations } = this.cachedData;

    for (const station of stations as any[]) {
      if (this.selectedLine !== 'ALL' && !station.lines.includes(this.selectedLine)) continue;

      const primaryLine = this.selectedLine !== 'ALL'
        ? this.selectedLine
        : (station.lines[0] ?? 'SV');
      const color = LINE_COLORS[primaryLine] ?? '#888';

      const marker = L.circleMarker([station.lat, station.lon] as L.LatLngExpression, {
        radius: 6,
        color: '#ffffff',
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.9,
      });

      // Lazy popup factory: reads incidentsByLine at open time so it reflects latest refresh
      marker.bindPopup(
        () => this.buildStationPopup(station, this.collectStationIncidents(station.lines)),
        { maxWidth: 290 }
      );

      marker.addTo(this.stationLayer);
      this.stationMarkerIndex.set(station.code, marker);
    }
  }

  private collectStationIncidents(lines: string[]): any[] {
    const seen = new Set<string>();
    const result: any[] = [];
    for (const line of lines) {
      for (const inc of this.incidentsByLine.get(line) ?? []) {
        if (!seen.has(inc.IncidentID)) {
          seen.add(inc.IncidentID);
          result.push(inc);
        }
      }
    }
    return result;
  }

  private buildStationPopup(station: any, stationIncidents: any[]): HTMLElement {
    const root = document.createElement('div');
    root.className = 'map-popup';

    const title = document.createElement('div');
    title.className = 'map-popup-title';
    title.textContent = station.name;
    root.appendChild(title);

    const linesDiv = document.createElement('div');
    linesDiv.className = 'map-popup-lines';
    for (const l of station.lines as string[]) {
      const chip = document.createElement('span');
      chip.className = 'map-line-chip';
      chip.style.background = LINE_COLORS[l] ?? '#888';
      chip.textContent = l;
      linesDiv.appendChild(chip);
    }
    root.appendChild(linesDiv);

    if (stationIncidents.length > 0) {
      const section = document.createElement('div');
      section.className = 'map-popup-incidents';

      const header = document.createElement('div');
      header.className = 'map-popup-incidents-header';
      header.textContent = `⚠ ${stationIncidents.length} Active Incident${stationIncidents.length > 1 ? 's' : ''}`;
      section.appendChild(header);

      for (const inc of stationIncidents.slice(0, 3)) {
        const desc = document.createElement('div');
        desc.className = 'map-popup-incident-desc';
        desc.textContent = inc.Description ?? '(No description)';
        section.appendChild(desc);
      }

      const btn = document.createElement('button');
      btn.className = 'map-popup-scroll-btn';
      btn.textContent = 'View in Incidents Panel ↓';
      btn.addEventListener('click', () => {
        document.getElementById('incidents-panel')?.scrollIntoView({ behavior: 'smooth' });
      });
      section.appendChild(btn);

      root.appendChild(section);
    }

    return root;
  }

  // ── Trains ─────────────────────────────────────────────────────────────────

  private rebuildTrains(): void {
    this.trainLayer.clearLayers();
    const trains = this.cachedData.trains as any[];

    for (const train of trains) {
      if (this.selectedLine !== 'ALL' && train.LineCode !== this.selectedLine) continue;

      const color = LINE_COLORS[train.LineCode] ?? '#888';

      const marker = L.circleMarker([train.lat, train.lon] as L.LatLngExpression, {
        radius: 5,
        color: color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      });

      marker.bindPopup(() => this.buildTrainPopup(train, color), { maxWidth: 220 });
      marker.addTo(this.trainLayer);
    }
  }

  private buildTrainPopup(train: any, color: string): HTMLElement {
    const root = document.createElement('div');
    root.className = 'map-popup';

    const title = document.createElement('div');
    title.className = 'map-popup-title';
    title.textContent = `Train ${train.TrainNumber || train.TrainId || '—'}`;
    root.appendChild(title);

    const lineDiv = document.createElement('div');
    lineDiv.className = 'map-popup-lines';
    const chip = document.createElement('span');
    chip.className = 'map-line-chip';
    chip.style.background = color;
    chip.textContent = train.LineCode;
    lineDiv.appendChild(chip);
    root.appendChild(lineDiv);

    const details: [string, string][] = [
      ['Cars', train.CarCount > 0 ? `${train.CarCount}` : 'Unknown'],
      ['Circuit', `${train.CircuitId}`],
      ['Direction', train.DirectionNum === 1 ? 'Northbound / Eastbound' : 'Southbound / Westbound'],
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

  // ── Incident highlights ────────────────────────────────────────────────────

  private rebuildIncidents(): void {
    // Refresh the shared incident index (used by station popup factories too)
    this.incidentsByLine.clear();
    for (const inc of this.cachedData.incidents as any[]) {
      const lines = (inc.LinesAffected ?? '').split(';')
        .map((l: string) => l.trim())
        .filter(Boolean);
      for (const l of lines) {
        if (!this.incidentsByLine.has(l)) this.incidentsByLine.set(l, []);
        this.incidentsByLine.get(l)!.push(inc);
      }
    }

    this.incidentLayer.clearLayers();
    if (!this.cachedData.incidents.length) return;

    const incidentLines = new Set(this.incidentsByLine.keys());

    for (const station of this.cachedData.stations as any[]) {
      if (this.selectedLine !== 'ALL' && !station.lines.includes(this.selectedLine)) continue;
      if (!(station.lines as string[]).some(l => incidentLines.has(l))) continue;

      const icon = L.divIcon({
        className: '',
        html: '<div class="pulse-ring"></div>',
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });

      L.marker([station.lat, station.lon] as L.LatLngExpression, {
        icon,
        interactive: false,
        zIndexOffset: -100,
      }).addTo(this.incidentLayer);
    }
  }
}
