import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'assets',
    loadComponent: () =>
      import('./assets/assets-page.component').then((m) => m.AssetsPageComponent),
  },
  {
    path: 'positions',
    loadComponent: () =>
      import('./positions/positions-page.component').then((m) => m.PositionsPageComponent),
  },
  {
    path: 'orders',
    loadComponent: () =>
      import('./orders/orders-page.component').then((m) => m.OrdersPageComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: '/assets' },
  { path: '**', redirectTo: '/assets' },
];
