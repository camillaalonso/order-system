import express, { Request, Response, NextFunction } from 'express';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Configurações de instabilidade (simula serviço de terceiro)
const CONFIG = {
  // Probabilidade de falha (0 a 1) - 20% de chance de falhar
  FAILURE_RATE: 0.2,
  // Latência mínima em ms
  MIN_LATENCY: 50,
  // Latência máxima em ms
  MAX_LATENCY: 2000,
  // Probabilidade de timeout (0 a 1) - 5% de chance de timeout
  TIMEOUT_RATE: 0.05,
  // Tempo de timeout em ms
  TIMEOUT_DURATION: 10000,
};

// Cotações base dos ativos
const quotations: Record<string, { symbol: string; name: string; price: number }> = {
  ITUB4: { symbol: 'ITUB4', name: 'Itaú Unibanco PN', price: 32.8 },
  ITUB3: { symbol: 'ITUB3', name: 'Itaú Unibanco ON', price: 15.4 },
  USDC: { symbol: 'USDC', name: 'USD Coin', price: 5.5 },
  SOL: { symbol: 'SOL', name: 'Solana', price: 418.07 },
  BTC: { symbol: 'BTC', name: 'Bitcoin', price: 350000.0 },
  ETH: { symbol: 'ETH', name: 'Ethereum', price: 18500.0 },
};

// Função para simular variação de preço (-5% a +5%)
function getQuotationWithVariation(base: { symbol: string; name: string; price: number }) {
  const variation = (Math.random() - 0.5) * 0.1; // -5% a +5%
  const currentPrice = base.price * (1 + variation);
  return {
    ...base,
    price: Math.round(currentPrice * 100) / 100,
    timestamp: new Date().toISOString(),
  };
}

// Função para simular latência variável
function getRandomLatency(): number {
  return Math.floor(Math.random() * (CONFIG.MAX_LATENCY - CONFIG.MIN_LATENCY + 1)) + CONFIG.MIN_LATENCY;
}

// Middleware para simular instabilidade
const unstableMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const latency = getRandomLatency();

  // Simula timeout (não responde)
  if (Math.random() < CONFIG.TIMEOUT_RATE) {
    console.log(`[${new Date().toISOString()}] Simulando timeout para ${req.path}`);
    // Simula um timeout real: não chama next() e não responde
    setTimeout(() => {
      // intentionally empty: request will hang until client timeout
    }, CONFIG.TIMEOUT_DURATION);
    return;
  }

  // Simula falha
  if (Math.random() < CONFIG.FAILURE_RATE) {
    console.log(`[${new Date().toISOString()}] Simulando falha para ${req.path} (latência: ${latency}ms)`);
    const errors = [
      { status: 500, message: 'Internal Server Error' },
      { status: 502, message: 'Bad Gateway' },
      { status: 503, message: 'Service Unavailable' },
      { status: 504, message: 'Gateway Timeout' },
    ];
    const error = errors[Math.floor(Math.random() * errors.length)];
    setTimeout(() => {
      res.status(error.status).json({ error: error.message });
    }, latency);
    return;
  }

  // Resposta normal com latência
  console.log(`[${new Date().toISOString()}] Processando ${req.path} (latência: ${latency}ms)`);
  setTimeout(() => next(), latency);
};

// Aplica middleware de instabilidade em todas as rotas de cotação
app.use('/quotations', unstableMiddleware);

// GET /quotations - Lista todas as cotações
app.get('/quotations', (req: Request, res: Response) => {
  const allQuotations = Object.values(quotations).map(getQuotationWithVariation);
  res.json({ data: allQuotations, timestamp: new Date().toISOString() });
});

// GET /quotations/:symbol - Retorna cotação de um ativo específico
app.get('/quotations/:symbol', (req: Request, res: Response) => {
  const symbol = String(req.params.symbol);
  const upperSymbol = symbol.toUpperCase();
  const quotation = quotations[upperSymbol];
  if (!quotation) {
    res.status(404).json({ error: 'Asset not found', symbol: upperSymbol });
    return;
  }
  res.json({ data: getQuotationWithVariation(quotation), timestamp: new Date().toISOString() });
});

// GET /health - Health check (não passa pelo middleware de instabilidade)
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    config: {
      failureRate: `${CONFIG.FAILURE_RATE * 100}%`,
      timeoutRate: `${CONFIG.TIMEOUT_RATE * 100}%`,
      latencyRange: `${CONFIG.MIN_LATENCY}ms - ${CONFIG.MAX_LATENCY}ms`,
    },
  });
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log('\nServiço de Cotações (Mock) - Digital Assets');
  console.log(`Servidor rodando em: http://localhost:${PORT}`);
  console.log('Este serviço simula uma API externa instável:');
  console.log(`  * Taxa de falha: ${CONFIG.FAILURE_RATE * 100}%`);
  console.log(`  * Taxa de timeout: ${CONFIG.TIMEOUT_RATE * 100}%`);
  console.log(`  * Latência: ${CONFIG.MIN_LATENCY}ms - ${CONFIG.MAX_LATENCY}ms`);
  console.log('\nEndpoints disponíveis:');
  console.log('GET /quotations         - Lista todas as cotações');
  console.log('GET /quotations/:symbol - Cotação de um ativo');
  console.log('GET /health             - Health check (estável)\n');
});
