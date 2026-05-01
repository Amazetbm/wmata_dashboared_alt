import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class WmataService {
  private readonly base = '/api';

  constructor(private http: HttpClient) {}

  getLiveIncidents(): Observable<any> {
    return this.http.get(`${this.base}/incidents/live`);
  }

  getHistoricalIncidents(from: string, to: string): Observable<any> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get(`${this.base}/incidents/history`, { params });
  }

  getLiveTrains(): Observable<any> {
    return this.http.get(`${this.base}/trains/live`);
  }

  getHistoricalTrains(from: string, to: string, line?: string): Observable<any> {
    let params = new HttpParams().set('from', from).set('to', to);
    if (line) params = params.set('line', line);
    return this.http.get(`${this.base}/trains/history`, { params });
  }

  getLiveElevators(): Observable<any> {
    return this.http.get(`${this.base}/elevators/live`);
  }

  getHistoricalElevators(from: string, to: string): Observable<any> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get(`${this.base}/elevators/history`, { params });
  }

  getPredictions(stationCode: string): Observable<any> {
    return this.http.get(`${this.base}/predictions/${stationCode}`);
  }

  getLiveAdherence(): Observable<any> {
    return this.http.get(`${this.base}/adherence/live`);
  }

  getHistoricalAdherence(from: string, to: string, line?: string): Observable<any> {
    let params = new HttpParams().set('from', from).set('to', to);
    if (line) params = params.set('line', line);
    return this.http.get(`${this.base}/adherence/history`, { params });
  }

  getAdherenceSnapshot(at: string): Observable<any> {
    const params = new HttpParams().set('at', at);
    return this.http.get(`${this.base}/adherence/snapshot`, { params });
  }

  getLiveOutages(): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/outages`);
  }

  getOutageHistory(from: string, to: string): Observable<any> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get(`${this.base}/outages/history`, { params });
  }

  getMapData(): Observable<any> {
    return this.http.get(`${this.base}/map`);
  }

  getBusMapData(): Observable<any> {
    return this.http.get(`${this.base}/bus/map`);
  }
}
