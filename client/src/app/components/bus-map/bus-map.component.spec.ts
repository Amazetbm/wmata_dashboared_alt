import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { BusMapComponent } from './bus-map.component';
import { WmataService } from '../../services/wmata.service';
import { MapCommandService } from '../../services/map-command.service';

vi.mock('chart.js/auto', () => ({
  default: class MockChart {
    static register = vi.fn();
    data = { labels: [], datasets: [{ data: [] }, { data: [] }] };
    update = vi.fn();
    destroy = vi.fn();
    constructor(_ctx: any, _config: any) {}
  },
}));

vi.mock('leaflet', () => ({
  map: vi.fn(() => ({
    setView: vi.fn().mockReturnThis(), addLayer: vi.fn(), removeLayer: vi.fn(),
    on: vi.fn(), off: vi.fn(), fitBounds: vi.fn(), panTo: vi.fn(),
    getBounds: vi.fn(() => ({ isValid: () => false })), getZoom: vi.fn(() => 12), setZoom: vi.fn(),
  })),
  tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
  layerGroup: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), clearLayers: vi.fn(), addLayer: vi.fn(), getLayers: vi.fn(() => []), eachLayer: vi.fn() })),
  circleMarker: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), bindPopup: vi.fn().mockReturnThis(), on: vi.fn().mockReturnThis(), setStyle: vi.fn(), bringToFront: vi.fn(), getLatLng: vi.fn(() => ({ lat: 38.9, lng: -77.0 })) })),
  marker: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), bindPopup: vi.fn().mockReturnThis(), on: vi.fn().mockReturnThis() })),
  polyline: vi.fn(() => ({ addTo: vi.fn().mockReturnThis(), setStyle: vi.fn() })),
  divIcon: vi.fn(() => ({})),
  latLngBounds: vi.fn(() => ({ isValid: () => false, extend: vi.fn() })),
  control: { layers: vi.fn(() => ({ addTo: vi.fn() })) },
  DomEvent: { stopPropagation: vi.fn() },
}));

vi.mock('leaflet.markercluster', () => ({}));

describe('BusMapComponent', () => {
  let component: BusMapComponent;
  let httpMock: HttpTestingController;
  let mapCommandService: MapCommandService;

  const fakeBusData = {
    routes: [{ RouteID: '10A', Description: 'Route 10A' }],
    positions: [], stops: [], incidents: [], routeShapes: {},
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BusMapComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        WmataService,
        MapCommandService,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(BusMapComponent);
    component = fixture.componentInstance;
    mapCommandService = TestBed.inject(MapCommandService);
    httpMock = TestBed.inject(HttpTestingController);

    // Mock all side-effectful methods before calling ngAfterViewInit
    vi.spyOn(component as any, 'initMap').mockImplementation(() => {});
    vi.spyOn(component as any, 'fetchAndRender').mockImplementation(() => {});
    vi.spyOn(component as any, 'fetchAndRefreshDynamic').mockImplementation(() => {});
    vi.spyOn(component as any, 'fetchHistory').mockImplementation(() => {});
    vi.spyOn(component, 'applyRouteSearch').mockImplementation(() => {});

    // Manually call ngAfterViewInit to set up the stream$ subscription
    component.ngAfterViewInit();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('focus_route action when data is ready calls applyRouteSearch', () => {
    component.busData = fakeBusData;
    mapCommandService.dispatch({ action: 'focus_route', target: '10A' });
    expect(component.applyRouteSearch).toHaveBeenCalledWith('10A');
  });

  it('focus_route action before data ready queues via setPendingBusAction', () => {
    component.busData = null;
    const setPendingSpy = vi.spyOn(mapCommandService, 'setPendingBusAction');
    mapCommandService.dispatch({ action: 'focus_route', target: '10A' });
    expect(setPendingSpy).toHaveBeenCalledWith({ action: 'focus_route', target: '10A' });
  });

  it('drainPendingBusAction returns stored action and clears slot', () => {
    mapCommandService.setPendingBusAction({ action: 'focus_route', target: '7Y' });
    const drained = mapCommandService.drainPendingBusAction();
    expect(drained).toEqual({ action: 'focus_route', target: '7Y' });
    expect(mapCommandService.drainPendingBusAction()).toBeNull();
  });
});
