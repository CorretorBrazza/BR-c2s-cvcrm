// Configuração compartilhada dos testes (jsdom).
// Nada de chrome APIs aqui: os módulos testados usam fallback em memória.

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}
