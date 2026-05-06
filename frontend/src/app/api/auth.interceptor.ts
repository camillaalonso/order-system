import { HttpInterceptorFn } from '@angular/common/http';

// Hardcoded user enquanto a auth fake do backend lê o header `x-user-id`.
// Quando a slice de JWT entrar, isso vira um interceptor que pega do storage.
export const FAKE_USER_ID = 'user-001';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const cloned = req.clone({
    setHeaders: { 'x-user-id': FAKE_USER_ID },
  });
  return next(cloned);
};
