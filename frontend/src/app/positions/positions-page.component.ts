import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../api/api.service';
import { Position } from '../api/api.types';

@Component({
  selector: 'app-positions-page',
  imports: [CommonModule],
  template: `
    <div class="page">
      <h1>Posição</h1>

      <div class="toolbar">
        <button class="btn" (click)="reload()" [disabled]="loading()">
          {{ loading() ? 'Carregando...' : 'Atualizar' }}
        </button>
      </div>

      @if (errorMsg()) {
        <div class="error">{{ errorMsg() }}</div>
      }

      @if (positions().length === 0 && !loading()) {
        <div class="empty">Nenhuma posição ainda.</div>
      } @else {
        <table>
          <thead>
            <tr>
              <th>Símbolo</th>
              <th>Nome</th>
              <th class="text-right">Quantidade</th>
              <th class="text-right">Preço médio</th>
            </tr>
          </thead>
          <tbody>
            @for (p of positions(); track p.symbol) {
              <tr>
                <td><strong>{{ p.symbol }}</strong></td>
                <td>{{ p.name }}</td>
                <td class="text-right">{{ p.quantity | number:'1.0-8' }}</td>
                <td class="text-right">{{ p.avgPrice | number:'1.2-4' }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
})
export class PositionsPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly positions = signal<Position[]>([]);
  readonly loading = signal(false);
  readonly errorMsg = signal<string | null>(null);

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.api.listPositions().subscribe({
      next: (data) => {
        this.positions.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.errorMsg.set('Erro ao carregar posições.');
        this.loading.set(false);
      },
    });
  }
}
