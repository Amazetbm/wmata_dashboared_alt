import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, timeout } from 'rxjs';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  reply: string;
  tools_used: string[];
  map_actions: { action: string; target: string }[];
}

export interface AssistantConfig {
  enabled: boolean;
  provider?: string;
  model?: string;
}

@Injectable({ providedIn: 'root' })
export class AssistantService {
  private readonly base = '/api/assistant';

  /** Whether the slide-out panel is open. Shared between NavBarComponent and AssistantPanelComponent. */
  readonly panelOpen = signal(false);

  constructor(private http: HttpClient) {}

  getConfig(): Observable<AssistantConfig> {
    return this.http.get<AssistantConfig>(`${this.base}/config`);
  }

  chat(question: string, history: ChatMessage[]): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(`${this.base}/chat`, { question, history }).pipe(
      timeout(45_000)
    );
  }

  togglePanel(): void {
    this.panelOpen.update(v => !v);
  }

  closePanel(): void {
    this.panelOpen.set(false);
  }
}
