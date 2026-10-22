import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AssistantPanelComponent } from './assistant-panel.component';
import { AssistantService } from '../../services/assistant.service';
import { MapCommandService } from '../../services/map-command.service';

// Stub marked to return input string for predictable DOM assertions
vi.mock('marked', () => ({
  marked: { parse: (_text: string, _opts?: any) => _text },
}));

describe('AssistantPanelComponent', () => {
  let fixture: ComponentFixture<AssistantPanelComponent>;
  let component: AssistantPanelComponent;
  let httpMock: HttpTestingController;
  let mapCommandService: MapCommandService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AssistantPanelComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AssistantService,
        MapCommandService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AssistantPanelComponent);
    component = fixture.componentInstance;
    mapCommandService = TestBed.inject(MapCommandService);
    httpMock = TestBed.inject(HttpTestingController);

    // Open the panel so the DOM renders
    TestBed.inject(AssistantService).panelOpen.set(true);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('submit posts {question, history} and renders reply text', async () => {
    component.inputText = 'Any Red Line delays?';
    component.submit();
    await fixture.whenStable();

    const req = httpMock.expectOne('/api/assistant/chat');
    expect(req.request.body.question).toBe('Any Red Line delays?');
    req.flush({ reply: 'No delays currently.', tools_used: [], map_actions: [] });
    await fixture.whenStable();

    const messages = fixture.nativeElement.querySelectorAll('.message');
    expect(messages.length).toBe(2); // user + assistant
    expect(fixture.nativeElement.textContent).toContain('No delays currently.');
  });

  it('displays tools_used chips', async () => {
    component.inputText = 'Check incidents';
    component.submit();
    await fixture.whenStable();

    const req = httpMock.expectOne('/api/assistant/chat');
    req.flush({ reply: 'Done.', tools_used: ['getRailIncidents'], map_actions: [] });
    await fixture.whenStable();

    const chips = fixture.nativeElement.querySelectorAll('.tools-used .chip');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain('getRailIncidents');
  });

  it('dispatches map_actions via MapCommandService', async () => {
    const dispatched: any[] = [];
    mapCommandService.stream$.subscribe(a => dispatched.push(a));

    component.inputText = 'Show Red Line';
    component.submit();
    await fixture.whenStable();

    const req = httpMock.expectOne('/api/assistant/chat');
    req.flush({
      reply: 'Done.',
      tools_used: [],
      map_actions: [{ action: 'focus_line', target: 'RD' }],
    });
    await fixture.whenStable();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual({ action: 'focus_line', target: 'RD' });
  });

  it('renders rate-limit message on 503 response', async () => {
    component.inputText = 'What time is it?';
    component.submit();
    await fixture.whenStable();

    const req = httpMock.expectOne('/api/assistant/chat');
    req.flush({ error: 'Rate limit exceeded' }, { status: 503, statusText: 'Service Unavailable' });
    await fixture.whenStable();

    expect(component.error()).toBeTruthy();
    const errorBanner = fixture.nativeElement.querySelector('.error-banner');
    expect(errorBanner).toBeTruthy();
  });

  it('renders error element on network error', async () => {
    component.inputText = 'Test';
    component.submit();
    await fixture.whenStable();

    const req = httpMock.expectOne('/api/assistant/chat');
    req.flush({ error: 'fail' }, { status: 500, statusText: 'Error' });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.error-banner')).toBeTruthy();
  });

  it('clearConversation empties message list', async () => {
    component.inputText = 'Hello';
    component.submit();
    await fixture.whenStable();

    const req = httpMock.expectOne('/api/assistant/chat');
    req.flush({ reply: 'Hi!', tools_used: [], map_actions: [] });
    await fixture.whenStable();

    expect(component.messages().length).toBeGreaterThan(0);

    component.clearConversation();
    await fixture.whenStable();

    expect(component.messages().length).toBe(0);
  });
});
