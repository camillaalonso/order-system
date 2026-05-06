import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api/api.service';
import { OrderSide } from '../api/api.types';

@Component({
  selector: 'app-new-order-modal',
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-backdrop" (click)="cancel()">
      <div class="modal" (click)="$event.stopPropagation()">
        <h2>Nova ordem</h2>

        @if (errorMsg()) {
          <div class="error">{{ errorMsg() }}</div>
        }

        <form (ngSubmit)="submit()" #f="ngForm">
          <div class="form-row">
            <label for="symbol">Ativo</label>
            <input
              id="symbol"
              name="symbol"
              [ngModel]="symbol"
              (ngModelChange)="symbol = $event.toUpperCase()"
              required
              autocapitalize="characters"
              spellcheck="false"
            />
          </div>

          <div class="form-row">
            <label for="side">Operação</label>
            <select id="side" name="side" [(ngModel)]="side" required>
              <option value="BUY">Comprar</option>
              <option value="SELL">Vender</option>
            </select>
          </div>

          <div class="form-row">
            <label for="quantity">Quantidade</label>
            <input
              id="quantity"
              name="quantity"
              type="number"
              step="0.00000001"
              min="0.00000001"
              [(ngModel)]="quantity"
              required
            />
          </div>

          <div class="form-actions">
            <button type="button" class="btn" (click)="cancel()" [disabled]="submitting()">
              Cancelar
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              [disabled]="submitting() || !f.form.valid"
            >
              {{ submitting() ? 'Enviando...' : 'Criar ordem' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `,
})
export class NewOrderModalComponent {
  @Input() set defaultSymbol(value: string | null) {
    if (value) this.symbol = value;
  }
  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<void>();

  private readonly api = inject(ApiService);

  symbol = '';
  side: OrderSide = 'BUY';
  quantity = 1;
  readonly submitting = signal(false);
  readonly errorMsg = signal<string | null>(null);

  cancel(): void {
    if (this.submitting()) return;
    this.closed.emit();
  }

  submit(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.errorMsg.set(null);

    this.api.createOrder({ symbol: this.symbol, side: this.side, quantity: this.quantity })
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.created.emit();
        },
        error: (err) => {
          this.submitting.set(false);
          const body = err?.error;
          this.errorMsg.set(formatApiError(body) ?? 'Erro inesperado.');
        },
      });
  }
}

function formatApiError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const e = body as { error?: string; symbol?: string };
  switch (e.error) {
    case 'asset_not_found':
      return `Ativo "${e.symbol}" não existe.`;
    case 'insufficient_cash':
      return 'Saldo de caixa insuficiente.';
    case 'insufficient_asset':
      return `Quantidade insuficiente de ${e.symbol}.`;
    case 'invalid_request':
      return 'Dados inválidos.';
    default:
      return e.error ?? null;
  }
}
