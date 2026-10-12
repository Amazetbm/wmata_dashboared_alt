import { Component, OnInit, signal, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AssistantService } from '../../services/assistant.service';

@Component({
  selector: 'app-nav-bar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './nav-bar.component.html',
  styleUrl: './nav-bar.component.scss',
})
export class NavBarComponent implements OnInit {
  private readonly assistantService = inject(AssistantService);

  assistantEnabled = signal(false);
  readonly panelOpen = this.assistantService.panelOpen;

  ngOnInit(): void {
    this.assistantService.getConfig().subscribe({
      next: cfg => this.assistantEnabled.set(cfg.enabled),
      error: () => this.assistantEnabled.set(false),
    });
  }

  togglePanel(): void {
    this.assistantService.togglePanel();
  }
}
