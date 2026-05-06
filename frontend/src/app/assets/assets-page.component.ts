import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../api/api.service';
import { Asset } from '../api/api.types';
import { NewOrderModalComponent } from '../orders/new-order-modal.component';

@Component({
  selector: 'app-assets-page',
  imports: [CommonModule, NewOrderModalComponent],
  template: `
    <div class="page">
      <h1>Ativos disponíveis</h1>

      <div class="toolbar">
        <button class="btn" (click)="reload()" [disabled]="loading()">
          {{ loading() ? 'Carregando...' : 'Atualizar' }}
        </button>
        <span class="muted">Cotação ao vivo do quotation-service; ativos marcados <em>fallback</em> usam o preço de referência.</span>
      </div>

      @if (errorMsg()) {
        <div class="error">{{ errorMsg() }}</div>
      }

      @if (assets().length === 0 && !loading()) {
        <div class="empty">Nenhum ativo cadastrado.</div>
      } @else {
        <table>
          <thead>
            <tr>
              <th>Símbolo</th>
              <th>Nome</th>
              <th class="text-right">Cotação</th>
              <th>Fonte</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (a of assets(); track a.symbol) {
              <tr>
                <td><strong>{{ a.symbol }}</strong></td>
                <td>{{ a.name }}</td>
                <td class="text-right">{{ a.price | number:'1.2-4' }}</td>
                <td>
                  <span class="badge"
                    [class.badge-executed]="a.quoteSource==='live'"
                    [class.badge-canceled]="a.quoteSource==='fallback'">
                    {{ a.quoteSource === 'live' ? 'ao vivo' : 'fallback' }}
                  </span>
                </td>
                <td class="text-right">
                  <button class="btn btn-primary" (click)="openModal(a.symbol)">Operar</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }

      @if (modalOpen()) {
        <app-new-order-modal
          [defaultSymbol]="modalSymbol()"
          (closed)="closeModal()"
          (created)="onCreated()"
        />
      }
    </div>
  `,
})
export class AssetsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly assets = signal<Asset[]>([]);
  readonly loading = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly modalOpen = signal(false);
  readonly modalSymbol = signal<string | null>(null);

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.api.listAssets().subscribe({
      next: (data) => {
        this.assets.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.errorMsg.set('Não foi possível carregar os ativos. Backend está no ar?');
        this.loading.set(false);
      },
    });
  }

  openModal(symbol: string): void {
    this.modalSymbol.set(symbol);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.modalSymbol.set(null);
  }

  onCreated(): void {
    this.closeModal();
    this.router.navigateByUrl('/orders');
  }
}
