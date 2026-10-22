import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { MapPanelComponent } from './map-panel.component';
import { WmataService } from '../../services/wmata.service';
import { MapCommandService } from '../../services/map-command.service';

vi.mock('leaflet', () => ({
  map: vi.fn(() => ({
    setView: vi.fn().mockReturnThis(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    fitBounds: vi.fn(),
    getBounds: vi.fn(() => ({ isValid: () => false })),
    panTo: vi.fn(),
    setZoom: vi.fn(),
  })),
  tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
  layerGroup: vi.fn(() => ({
    addTo: vi.fn().mockReturnThis(),
    clearLayers: vi.fn(),
    addLayer: vi.fn(),
    getLayers: vi.fn(() => []),
    eachLayer: vi.fn(),
  })),
  circleMarker: vi.fn(() => ({
    addTo: vi.fn().mockReturnThis(),
    bindPopup: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    setStyle: vi.fn(),
    bringToFront: vi.fn(),
  })),
  polyline: vi.fn(() => ({
    addTo: vi.fn().mockReturnThis(),
    setStyle: vi.fn(),
  })),
  latLngBounds: vi.fn(() => ({ isValid: () => false, extend: vi.fn() })),
  control: { layers: vi.fn(() => ({ addTo: vi.fn() })) },
  DomEvent: { stopPropagation: vi.fn() },
}));

describe('MapPanelComponent', () => {
  let fixture: ComponentFixture<MapPanelComponent>;
  let component: MapPanelComponent;
  let httpMock: HttpTestingController;
  let mapCommandService: MapCommandService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapPanelComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        WmataService,
        MapCommandService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MapPanelComponent);
    component = fixture.componentInstance;
    mapCommandService = TestBed.inject(MapCommandService);

    // Prevent initMap / fetchAndRender from running (no canvas in jsdom)
    vi.spyOn(component as any, 'initMap').mockImplementation(() => {});
    vi.spyOn(component as any, 'fetchAndRender').mockImplementation(() => {});
    vi.spyOn(component as any, 'fetchAndRefreshDynamic').mockImplementation(() => {});

    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock?.verify();
  });

  it('focus_line action calls selectLine with correct arg', () => {
    const selectLineSpy = vi.spyOn(component, 'selectLine').mockImplementation(() => {});

    mapCommandService.dispatch({ action: 'focus_line', target: 'RD' });

    expect(selectLineSpy).toHaveBeenCalledWith('RD');
  });

  it('focus_station action calls panToStation with correct station code', () => {
    const panToStationSpy = vi.spyOn(component, 'panToStation').mockImplementation(() => {});

    mapCommandService.dispatch({ action: 'focus_station', target: 'A01' });

    expect(panToStationSpy).toHaveBeenCalledWith('A01');
  });
});
