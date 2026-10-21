import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AssistantService } from './assistant.service';

describe('AssistantService', () => {
  let service: AssistantService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), AssistantService],
    });
    service = TestBed.inject(AssistantService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('getConfig() hits GET /api/assistant/config', () => {
    service.getConfig().subscribe();
    const req = httpMock.expectOne('/api/assistant/config');
    expect(req.request.method).toBe('GET');
    req.flush({ enabled: true });
  });

  it('chat() posts to POST /api/assistant/chat', () => {
    service.chat('hello', []).subscribe();
    const req = httpMock.expectOne('/api/assistant/chat');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.question).toBe('hello');
    expect(req.request.body.history).toEqual([]);
    req.flush({ reply: 'Hi!', tools_used: [], map_actions: [] });
  });

  it('chat() sends history in request body', () => {
    const history = [{ role: 'user' as const, content: 'prev' }];
    service.chat('follow-up', history).subscribe();
    const req = httpMock.expectOne('/api/assistant/chat');
    expect(req.request.body.history).toEqual(history);
    req.flush({ reply: 'done', tools_used: [], map_actions: [] });
  });

  it('panelOpen starts as false', () => {
    expect(service.panelOpen()).toBe(false);
  });

  it('togglePanel() flips panelOpen', () => {
    service.togglePanel();
    expect(service.panelOpen()).toBe(true);
    service.togglePanel();
    expect(service.panelOpen()).toBe(false);
  });

  it('closePanel() sets panelOpen to false', () => {
    service.togglePanel(); // open
    service.closePanel();
    expect(service.panelOpen()).toBe(false);
  });

  it('closePanel() is idempotent when already closed', () => {
    service.closePanel();
    expect(service.panelOpen()).toBe(false);
  });
});
