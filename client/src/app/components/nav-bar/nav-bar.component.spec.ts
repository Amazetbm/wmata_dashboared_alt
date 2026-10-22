import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { NavBarComponent } from './nav-bar.component';
import { AssistantService } from '../../services/assistant.service';

describe('NavBarComponent', () => {
  let fixture: ComponentFixture<NavBarComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavBarComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        AssistantService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NavBarComponent);
    fixture.autoDetectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('Ask button absent when config returns enabled: false', async () => {
    const req = httpMock.expectOne('/api/assistant/config');
    req.flush({ enabled: false });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.ask-btn')).toBeNull();
  });

  it('Ask button present when config returns enabled: true', async () => {
    const req = httpMock.expectOne('/api/assistant/config');
    req.flush({ enabled: true, provider: 'anthropic', model: 'claude-sonnet-4-6' });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.ask-btn')).toBeTruthy();
  });

  it('Ask button absent on config fetch error', async () => {
    const req = httpMock.expectOne('/api/assistant/config');
    req.flush({ error: 'fail' }, { status: 500, statusText: 'Error' });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.ask-btn')).toBeNull();
  });
});
