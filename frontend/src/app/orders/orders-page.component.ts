import { CommonModule } from '@angular/common';
import {
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { interval } from 'rxjs';
import { ApiService } from '../api/api.service';
import { Order, OrderStatus } from '../api/api.types';
import { NewOrderModalComponent } from './new-order-modal.component';

@Component({
  selector: 'app-orders-page',
  imports: [CommonModule, FormsModule, NewOrderModalComponent],
  template: `
    <div class="page">
      <h1>Ordens</h1>

      <div class="toolbar">
        <button class="btn btn-primary" (click)="openModal()">+ Nova ordem</button>

        <label class="muted">
          Filtro:
          <select [(ngModel)]="statusFilter" (ngModelChange)="reload()">
            <option [ngValue]="null">Todas</option>
            <option value="PENDING">Pendentes</option>
            <option value="EXECUTED">Executadas</option>
            <option value="FAILED">Falharam</option>
            <option value="CANCELED">Canceladas</option>
          </select>
        </label>

        <button class="btn" (click)="reload()" [disabled]="loading()">
          {{ loading() ? 'Carregando...' : 'Atualizar' }}
        </button>

        <span class="muted">Auto-atualiza enquanto houver ordens pendentes.</span>
      </div>

      @if (errorMsg()) {
        <div class="error">{{ errorMsg() }}</div>
      }

      @if (orders().length === 0 && !loading()) {
        <div class="empty">Nenhuma ordem ainda.</div>
      } @else {
        <table>
          <thead>
            <tr>
              <th>Criada</th>
              <th>Símbolo</th>
              <th>Lado</th>
              <th class="text-right">Qtd</th>
              <th class="text-right">Preço</th>
              <th class="text-right">Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (o of orders(); track o.id) {
              <tr>
                <td class="muted">{{ o.createdAt | date:'short' }}</td>
                <td><strong>{{ o.symbol }}</strong></td>
                <td>
                  <span class="badge" [class.badge-buy]="o.side==='BUY'" [class.badge-sell]="o.side==='SELL'">
                    {{ o.side === 'BUY' ? 'Compra' : 'Venda' }}
                  </span>
                </td>
                <td class="text-right">{{ o.quantity | number:'1.0-8' }}</td>
                <td class="text-right">{{ o.price | number:'1.2-4' }}</td>
                <td class="text-right">{{ o.totalAmount | number:'1.2-2' }}</td>
                <td>
                  <span class="badge"
                    [class.badge-pending]="o.status==='PENDING'"
                    [class.badge-executed]="o.status==='EXECUTED'"
                    [class.badge-failed]="o.status==='FAILED'"
                    [class.badge-canceled]="o.status==='CANCELED'"
                    [title]="o.failureReason ?? ''">
                    {{ statusLabel(o.status) }}
                  </span>
                </td>
                <td class="text-right">
                  @if (o.status === 'PENDING') {
                    <button
                      class="btn btn-danger"
                      (click)="cancel(o.id)"
                      [disabled]="cancelingId() === o.id">
                      {{ cancelingId() === o.id ? 'Cancelando...' : 'Cancelar' }}
                    </button>
                  }
                  @if (o.status === 'FAILED' && o.failureReason) {
                    <span class="muted" [title]="o.failureReason">motivo</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (modalOpen()) {
        <app-new-order-modal
          (closed)="closeModal()"
          (created)="onCreated()"
        />
      }
    </div>
  `,
})
export class OrdersPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly orders = signal<Order[]>([]);
  readonly loading = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly cancelingId = signal<string | null>(null);
  readonly modalOpen = signal(false);
  statusFilter: OrderStatus | null = null;

  ngOnInit(): void {
    this.reload();
    interval(2000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.orders().some((o) => o.status === 'PENDING')) {
          this.reload();
        }
      });
  }

  reload(): void {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.api.listOrders(this.statusFilter ?? undefined).subscribe({
      next: (data) => {
        this.orders.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.errorMsg.set('Erro ao carregar ordens.');
        this.loading.set(false);
      },
    });
  }

  cancel(id: string): void {
    if (this.cancelingId()) return;
    this.cancelingId.set(id);
    this.api.cancelOrder(id).subscribe({
      next: () => {
        this.cancelingId.set(null);
        this.reload();
      },
      error: (err) => {
        this.cancelingId.set(null);
        const code = err?.error?.error;
        if (code === 'order_not_cancelable') {
          this.errorMsg.set('Não foi possível cancelar — ordem já não está pendente.');
        } else if (code === 'order_not_found') {
          this.errorMsg.set('Ordem não encontrada.');
        } else {
          this.errorMsg.set('Erro ao cancelar ordem.');
        }
        this.reload();
      },
    });
  }

  openModal(): void {
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
  }

  onCreated(): void {
    this.closeModal();
    this.reload();
  }

  statusLabel(s: OrderStatus): string {
    return {
      PENDING: 'Pendente',
      EXECUTED: 'Executada',
      FAILED: 'Rejeitada',
      CANCELED: 'Cancelada',
    }[s];
  }
}
