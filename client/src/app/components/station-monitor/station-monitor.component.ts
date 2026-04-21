import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WmataService } from '../../services/wmata.service';

const STATIONS: { code: string; name: string }[] = [
  // ── Red Line ────────────────────────────────────────────────────────────────
  { code: 'A15', name: 'Shady Grove' },
  { code: 'A14', name: 'Rockville' },
  { code: 'A13', name: 'Twinbrook' },
  { code: 'A12', name: 'White Flint' },
  { code: 'A11', name: 'Grosvenor-Strathmore' },
  { code: 'A10', name: 'Medical Center' },
  { code: 'A09', name: 'Bethesda' },
  { code: 'A08', name: 'Friendship Heights' },
  { code: 'A07', name: 'Tenleytown-AU' },
  { code: 'A06', name: 'Van Ness-UDC' },
  { code: 'A05', name: 'Cleveland Park' },
  { code: 'A04', name: 'Woodley Park-Zoo/Adams Morgan' },
  { code: 'A03', name: 'Dupont Circle' },
  { code: 'A02', name: 'Farragut North' },
  { code: 'A01', name: 'Metro Center (RD)' },
  { code: 'B35', name: 'New York Ave-Florida Ave-Gallaudet U' },
  { code: 'B01', name: 'Gallery Pl-Chinatown (RD)' },
  { code: 'B02', name: 'Judiciary Square' },
  { code: 'B03', name: 'Union Station' },
  { code: 'B04', name: 'Rhode Island Ave-Brentwood' },
  { code: 'B05', name: 'Brookland-CUA' },
  { code: 'B06', name: 'Fort Totten (RD)' },
  { code: 'B07', name: 'Takoma' },
  { code: 'B08', name: 'Silver Spring' },
  { code: 'B09', name: 'Forest Glen' },
  { code: 'B10', name: 'Wheaton' },
  { code: 'B11', name: 'Glenmont' },

  // ── Silver Line (west) ───────────────────────────────────────────────────────
  { code: 'N12', name: 'Ashburn' },
  { code: 'N11', name: 'Loudoun Gateway' },
  { code: 'N10', name: 'Washington Dulles International Airport' },
  { code: 'N09', name: 'Innovation Center' },
  { code: 'N08', name: 'Herndon' },
  { code: 'N07', name: 'Reston Town Center' },
  { code: 'N06', name: 'Wiehle-Reston East' },
  { code: 'N04', name: 'Spring Hill' },
  { code: 'N03', name: 'Greensboro' },
  { code: 'N02', name: 'Tysons Corner' },
  { code: 'N01', name: 'McLean' },

  // ── Orange Line (west) ───────────────────────────────────────────────────────
  { code: 'K08', name: 'Vienna/Fairfax-GMU' },
  { code: 'K07', name: 'Dunn Loring-Merrifield' },
  { code: 'K06', name: 'West Falls Church-VT/UVA' },
  { code: 'K05', name: 'East Falls Church' },
  { code: 'K04', name: 'Ballston-MU' },
  { code: 'K03', name: 'Virginia Square-GMU' },
  { code: 'K02', name: 'Clarendon' },
  { code: 'K01', name: 'Court House' },

  // ── Blue/Orange/Silver (shared Virginia/DC trunk) ────────────────────────────
  { code: 'C05', name: 'Rosslyn' },
  { code: 'C04', name: 'Foggy Bottom-GWU' },
  { code: 'C03', name: 'Farragut West' },
  { code: 'C02', name: 'McPherson Square' },
  { code: 'C01', name: 'Metro Center (BL/OR/SV)' },
  { code: 'D01', name: 'Federal Triangle' },
  { code: 'D02', name: 'Smithsonian' },
  { code: 'D03', name: "L'Enfant Plaza (BL/OR/SV)" },
  { code: 'D04', name: 'Federal Center SW' },
  { code: 'D05', name: 'Capitol South' },
  { code: 'D06', name: 'Eastern Market' },
  { code: 'D07', name: 'Potomac Ave' },
  { code: 'D08', name: 'Stadium-Armory' },

  // ── Blue Line (east branch) ──────────────────────────────────────────────────
  { code: 'G01', name: 'Benning Road' },
  { code: 'G02', name: 'Capitol Heights' },
  { code: 'G03', name: 'Addison Road-Seat Pleasant' },
  { code: 'G04', name: 'Morgan Boulevard' },
  { code: 'G05', name: 'Largo Town Center' },

  // ── Blue/Yellow (south — Pentagon branch) ────────────────────────────────────
  { code: 'C06', name: 'Arlington Cemetery' },
  { code: 'C07', name: 'Pentagon' },
  { code: 'C08', name: 'Pentagon City' },
  { code: 'C09', name: 'Crystal City' },
  { code: 'C10', name: 'Reagan National Airport' },
  { code: 'C12', name: 'Braddock Road' },
  { code: 'C13', name: 'King St-Old Town' },

  // ── Yellow Line (south terminus) ─────────────────────────────────────────────
  { code: 'C14', name: 'Eisenhower Avenue' },
  { code: 'C15', name: 'Huntington' },

  // ── Green/Yellow (shared trunk) ──────────────────────────────────────────────
  { code: 'F01', name: 'Gallery Pl-Chinatown (GR/YL)' },
  { code: 'F02', name: 'Archives-Navy Memorial-Penn Quarter' },
  { code: 'F03', name: "L'Enfant Plaza (GR/YL)" },
  { code: 'F04', name: 'Waterfront' },
  { code: 'F05', name: 'Navy Yard-Ballpark' },
  { code: 'F06', name: 'Anacostia' },
  { code: 'F07', name: 'Congress Heights' },
  { code: 'F08', name: 'Southern Avenue' },
  { code: 'F09', name: 'Naylor Road' },
  { code: 'F10', name: 'Suitland' },
  { code: 'F11', name: 'Branch Ave' },

  // ── Green/Yellow (north) ─────────────────────────────────────────────────────
  { code: 'E01', name: 'Mt Vernon Sq 7th St-Convention Center' },
  { code: 'E02', name: 'Shaw-Howard U' },
  { code: 'E03', name: 'U Street/African-Amer Civil War Memorial/Cardozo' },
  { code: 'E04', name: 'Columbia Heights' },
  { code: 'E05', name: 'Georgia Ave-Petworth' },
  { code: 'E06', name: 'Fort Totten (GR/YL)' },

  // ── Green Line (northeast terminus) ──────────────────────────────────────────
  { code: 'E07', name: 'West Hyattsville' },
  { code: 'E08', name: "Prince George's Plaza" },
  { code: 'E09', name: 'College Park-U of MD' },
  { code: 'E10', name: 'Greenbelt' },
];

@Component({
  selector: 'app-station-monitor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './station-monitor.component.html',
  styleUrl: './station-monitor.component.scss'
})
export class StationMonitorComponent implements OnInit, OnDestroy {
  stations = STATIONS;
  selectedCode = 'A01';
  predictions: any[] = [];
  loading = false;
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
    this.loading = true;
    this.wmata.getPredictions(this.selectedCode).subscribe({
      next: data => {
        this.predictions = data.Trains || [];
        this.loading = false;
        this.error = '';
      },
      error: err => {
        this.error = err.message;
        this.loading = false;
      }
    });
  }

  onStationChange() {
    this.predictions = [];
    this.load();
  }

  minuteClass(min: string): string {
    if (min === 'ARR') return 'arr';
    if (min === 'BRD') return 'brd';
    const n = parseInt(min, 10);
    if (isNaN(n)) return '';
    return n <= 2 ? 'soon' : '';
  }
}
