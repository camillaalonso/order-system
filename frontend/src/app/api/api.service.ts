import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Asset,
  CreateOrderInput,
  Order,
  OrderStatus,
  Position,
} from './api.types';

const BASE_URL = 'http://localhost:3000';

type Wrapped<T> = { data: T };

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  listAssets(): Observable<Asset[]> {
    return this.unwrap(this.http.get<Wrapped<Asset[]>>(`${BASE_URL}/assets`));
  }

  listPositions(): Observable<Position[]> {
    return this.unwrap(this.http.get<Wrapped<Position[]>>(`${BASE_URL}/positions`));
  }

  listOrders(status?: OrderStatus): Observable<Order[]> {
    const url = status ? `${BASE_URL}/orders?status=${status}` : `${BASE_URL}/orders`;
    return this.unwrap(this.http.get<Wrapped<Order[]>>(url));
  }

  getOrder(id: string): Observable<Order> {
    return this.unwrap(this.http.get<Wrapped<Order>>(`${BASE_URL}/orders/${id}`));
  }

  createOrder(input: CreateOrderInput): Observable<Order> {
    return this.unwrap(this.http.post<Wrapped<Order>>(`${BASE_URL}/orders`, input));
  }

  cancelOrder(id: string): Observable<Order> {
    return this.unwrap(this.http.delete<Wrapped<Order>>(`${BASE_URL}/orders/${id}`));
  }

  private unwrap<T>(source$: Observable<Wrapped<T>>): Observable<T> {
    return new Observable((subscriber) => {
      const sub = source$.subscribe({
        next: (res) => subscriber.next(res.data),
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });
      return () => sub.unsubscribe();
    });
  }
}
