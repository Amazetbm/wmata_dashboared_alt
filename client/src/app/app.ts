import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavBarComponent } from './components/nav-bar/nav-bar.component';
import { AssistantPanelComponent } from './components/assistant-panel/assistant-panel.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavBarComponent, AssistantPanelComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
