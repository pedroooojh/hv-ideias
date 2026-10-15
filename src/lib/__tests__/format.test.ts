import { describe, expect, it } from 'vitest';
import { formatPoints, formatRelative, initials, plural } from '../format';
import { lengthError } from '../domain';

describe('formatação', () => {
  it('formata pontos com uma casa decimal em pt-BR', () => {
    expect(formatPoints(3)).toBe('3,0');
    expect(formatPoints(4.5)).toBe('4,5');
  });

  it('descreve datas relativas', () => {
    const now = new Date(2026, 9, 14, 12);
    expect(formatRelative(new Date(2026, 9, 14, 8), now)).toBe('hoje');
    expect(formatRelative(new Date(2026, 9, 13, 23), now)).toBe('ontem');
    expect(formatRelative(new Date(2026, 9, 10), now)).toBe('há 4 dias');
  });

  it('pluraliza e gera iniciais', () => {
    expect(plural(1, 'voto', 'votos')).toBe('1 voto');
    expect(plural(1200, 'voto', 'votos')).toBe('1.200 votos');
    expect(initials('Carlos Eduardo Lima')).toBe('CL');
    expect(initials('')).toBe('?');
  });

  it('valida comprimento como o banco (ignorando espaços nas pontas)', () => {
    expect(lengthError('   ', 'Título', { min: 5, max: 150 })).toBe('Título é obrigatório.');
    expect(lengthError(' abc ', 'Título', { min: 5, max: 150 })).toContain('pelo menos 5');
    expect(lengthError('Título válido', 'Título', { min: 5, max: 150 })).toBeNull();
  });
});
