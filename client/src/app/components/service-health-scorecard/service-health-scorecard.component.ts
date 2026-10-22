import { Component, OnInit, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';
import { WmataService } from '../../services/wmata.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { timer, EMPTY } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';

const LINE_COLORS: Record<string, string> = {
  RD: '#BF0000', BL: '#009CDE', YL: '#FFD700',
  OR: '#ED8B00', GR: '#00B140', SV: '#919D9D',
};

const LINE_NAMES: Record<string, string> = {
  RD: 'Red', BL: 'Blue', YL: 'Yellow',
  OR: 'Orange', GR: 'Green', SV: 'Silver',
};

// Maps WMATA station codes to the lines that serve them.
// Used to attribute elevator/escalator outages to affected lines.
const STATION_LINES: Record<string, string[]> = {
  // Red – Shady Grove branch
  A01: ['RD'], A02: ['RD'], A03: ['RD'], A04: ['RD'], A05: ['RD'],
  A06: ['RD'], A07: ['RD'], A08: ['RD'], A09: ['RD'], A10: ['RD'],
  A11: ['RD'], A12: ['RD'], A13: ['RD'], A14: ['RD'], A15: ['RD'],
  // Red – Glenmont branch (B01=Gallery Place and B07=Fort Totten are transfer stations)
  B01: ['RD', 'YL', 'GR'], B02: ['RD'], B03: ['RD'], B04: ['RD'],
  B05: ['RD'], B06: ['RD'], B07: ['RD', 'YL', 'GR'], B08: ['RD'],
  B09: ['RD'], B10: ['RD'], B11: ['RD'], B12: ['RD'],
  // Blue/Orange/Silver – Virginia & downtown core
  C01: ['BL', 'OR', 'SV'], C02: ['BL', 'OR', 'SV'], C03: ['BL', 'OR', 'SV'],
  C04: ['BL', 'OR', 'SV'], C05: ['BL', 'OR', 'SV'],
  C06: ['BL'],
  C07: ['BL', 'YL'], C08: ['BL', 'YL'], C09: ['BL', 'YL'], C10: ['BL', 'YL'],
  C12: ['BL', 'YL'], C13: ['BL', 'YL'], C14: ['YL'], C15: ['YL'],
  // Blue/Orange/Silver – Maryland core
  D01: ['BL', 'OR', 'SV'], D02: ['BL', 'OR', 'SV'], D03: ['BL', 'OR', 'SV'],
  D04: ['BL', 'OR', 'SV'], D05: ['BL', 'OR', 'SV'],
  D06: ['BL', 'SV'], D07: ['BL', 'SV'], D08: ['OR', 'SV'],
  // Yellow/Green – shared core
  E01: ['YL', 'GR'], E02: ['YL', 'GR'], E03: ['YL', 'GR'],
  E04: ['YL', 'GR'], E05: ['YL', 'GR'], E06: ['YL', 'GR'],
  // Green – Maryland branch
  E07: ['GR'], E08: ['GR'], E09: ['GR'], E10: ['GR'],
  // Yellow/Green – southern core (F03=L'Enfant Plaza serves all lines)
  F01: ['YL', 'GR'], F02: ['YL', 'GR'],
  F03: ['BL', 'OR', 'YL', 'GR', 'SV'],
  // Green – Branch Ave branch
  F04: ['GR'], F05: ['GR'], F06: ['GR'], F07: ['GR'],
  F08: ['GR'], F09: ['GR'], F10: ['GR'], F11: ['GR'],
  // Blue – Franconia/Springfield branch
  G01: ['BL'], G02: ['BL'],
  // Orange/Silver – Vienna branch
  K01: ['OR', 'SV'], K02: ['OR', 'SV'], K03: ['OR', 'SV'], K04: ['OR', 'SV'],
  K05: ['OR', 'SV'], K06: ['OR', 'SV'], K07: ['OR', 'SV'], K08: ['OR', 'SV'],
  // Silver – Dulles/Loudoun extension
  N01: ['SV'], N02: ['SV'], N03: ['SV'], N04: ['SV'], N06: ['SV'],
  N07: ['SV'], N08: ['SV'], N09: ['SV'], N10: ['SV'], N11: ['SV'], N12: ['SV'],
};

const LINE_ORDER = ['RD', 'BL', 'OR', 'YL', 'GR', 'SV'];

interface LineScore {
  lineCode: string;
  lineName: string;
  color: string;
  adherencePct: number;
  incidentCount: number;
  outageCount: number;
  status: 'good' | 'minor' | 'degraded';
  noData: boolean;
}

@Component({
  selector: 'app-service-health-scorecard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './service-health-scorecard.component.html',
  styleUrl: './service-health-scorecard.component.scss'
})
export class ServiceHealthScorecardComponent implements OnInit {
  lineScores = signal<LineScore[]>([]);
  loading = signal(true);
  error = signal('');
  lastUpdated = signal<Date | null>(null);
  private destroyRef = inject(DestroyRef);

  constructor(private wmata: WmataService) {}

  ngOnInit() {
    timer(0, 30_000).pipe(
      switchMap(() => forkJoin([
        this.wmata.getLiveAdherence(),
        this.wmata.getLiveIncidents(),
        this.wmata.getLiveOutages(),
      ]).pipe(
        catchError(err => { this.error.set(err.message); this.loading.set(false); return EMPTY; })
      )),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(([adherenceData, incidentData, outageData]) => {
      this.lineScores.set(this.buildScores(adherenceData, incidentData, outageData));
      this.lastUpdated.set(new Date());
      this.loading.set(false);
      this.error.set('');
    });
  }

  private buildScores(adherenceData: any, incidentData: any, outageData: any[]): LineScore[] {
    const lineSummaries: any[] = adherenceData?.lineSummaries ?? [];
    const incidents: any[] = incidentData?.Incidents ?? [];
    const outages: any[] = Array.isArray(outageData) ? outageData : [];

    return LINE_ORDER.map(lineCode => {
      const summary = lineSummaries.find((s: any) => s.lineCode === lineCode);
      const noData = !summary || summary.total === 0;
      const adherencePct = noData ? 100 : Math.round((summary.onTime / summary.total) * 100);

      const incidentCount = incidents.filter((inc: any) => {
        const affected: string[] = (inc.LinesAffected ?? '')
          .split(';')
          .map((l: string) => l.trim())
          .filter((l: string) => l.length > 0);
        return affected.includes(lineCode);
      }).length;

      const outageCount = outages.filter((o: any) => {
        const lines = STATION_LINES[o.StationCode] ?? [];
        return lines.includes(lineCode);
      }).length;

      return {
        lineCode,
        lineName: LINE_NAMES[lineCode],
        color: LINE_COLORS[lineCode],
        adherencePct,
        incidentCount,
        outageCount,
        status: this.computeStatus(adherencePct, incidentCount, outageCount, noData),
        noData,
      };
    });
  }

  private computeStatus(
    adherencePct: number,
    incidentCount: number,
    outageCount: number,
    noData: boolean
  ): 'good' | 'minor' | 'degraded' {
    if (noData) return 'good';

    let status: 'good' | 'minor' | 'degraded';
    if (adherencePct < 70 || incidentCount >= 3) {
      status = 'degraded';
    } else if (adherencePct < 85 || incidentCount >= 1) {
      status = 'minor';
    } else {
      status = 'good';
    }

    // Outages nudge status worse but never override a degraded adherence reading
    if (status === 'good' && outageCount >= 3) {
      status = 'degraded';
    } else if (status === 'good' && outageCount >= 1) {
      status = 'minor';
    }

    return status;
  }

  secondsAgo(): number {
    const lu = this.lastUpdated();
    if (!lu) return 0;
    return Math.round((Date.now() - lu.getTime()) / 1000);
  }
}
