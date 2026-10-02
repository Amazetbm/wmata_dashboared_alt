import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AssistantService, ChatMessage, ChatResponse } from '../../services/assistant.service';
import { MapCommandService, MapAction } from '../../services/map-command.service';

interface DisplayMessage {
  role: 'user' | 'assistant';
  text: string;
  toolsUsed?: string[];
}

const EXAMPLE_QUESTIONS = [
  'Are there any active Red Line incidents right now?',
  'How is schedule adherence on the Blue Line today?',
  'What are the next trains at Metro Center?',
  'Are any elevators or escalators out of service?',
  'Which bus routes had the most incidents this week?',
];

@Component({
  selector: 'app-assistant-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './assistant-panel.component.html',
  styleUrl: './assistant-panel.component.scss',
})
export class AssistantPanelComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('messageList') messageListRef?: ElementRef<HTMLElement>;
  @ViewChild('inputEl') inputRef?: ElementRef<HTMLTextAreaElement>;

  private readonly assistantService = inject(AssistantService);
  private readonly mapCommandService = inject(MapCommandService);

  readonly panelOpen = this.assistantService.panelOpen;

  messages = signal<DisplayMessage[]>([]);
  inputText = '';
  loading = signal(false);
  error = signal('');
  readonly examples = EXAMPLE_QUESTIONS;

  private history: ChatMessage[] = [];
  private shouldScrollBottom = false;

  ngOnInit(): void {}

  ngOnDestroy(): void {}

  ngAfterViewChecked(): void {
    if (this.shouldScrollBottom) {
      this.scrollToBottom();
      this.shouldScrollBottom = false;
    }
  }

  submit(text?: string): void {
    const question = (text ?? this.inputText).trim();
    if (!question || this.loading()) return;

    this.inputText = '';
    this.error.set('');
    this.messages.update(msgs => [...msgs, { role: 'user', text: question }]);
    this.loading.set(true);
    this.shouldScrollBottom = true;

    this.assistantService.chat(question, this.history).subscribe({
      next: (response: ChatResponse) => {
        this.loading.set(false);
        this.messages.update(msgs => [...msgs, {
          role: 'assistant',
          text: response.reply,
          toolsUsed: response.tools_used,
        }]);
        // Update flat history for next turn
        this.history.push({ role: 'user', content: question });
        this.history.push({ role: 'assistant', content: response.reply });
        // Cap at 20 messages to match server limit
        if (this.history.length > 20) this.history = this.history.slice(-20);
        // Dispatch map actions
        for (const action of (response.map_actions || [])) {
          this.mapCommandService.dispatch(action as MapAction);
        }
        this.shouldScrollBottom = true;
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.error || 'Something went wrong. Please try again.');
        this.shouldScrollBottom = true;
      },
    });
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    }
  }

  clearConversation(): void {
    this.messages.set([]);
    this.history = [];
    this.error.set('');
  }

  close(): void {
    this.assistantService.closePanel();
  }

  private scrollToBottom(): void {
    const el = this.messageListRef?.nativeElement;
    if (el) el.scrollTop = el.scrollHeight;
  }
}
