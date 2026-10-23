import { describe, expect, it } from 'vitest';
import {
  daysUntilClose,
  formatMonth,
  formatPoints,
  formatRelative,
  formatWeekRange,
  initials,
  isMonthClosingDay,
  isMonthOpeningDay,
  isRankingClosingDay,
  plural,
  rankingDayKey,
} from '../format';
import { lengthError } from '../domain';

describe('formatação', () => {
  it('formata pontos com uma casa decimal em pt-BR', () => {
    expect(formatPoints(3)).toBe('3,0');
    expect(formatPoints(4.5)).toBe('4,5');
    expect(formatPoints(8.75)).toBe('8,75');
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

  it('descreve a semana do ranking no horário de Brasília', () => {
    // Sábado 10/10 00:00 a sábado 17/10 00:00 (BRT = UTC-3).
    expect(formatWeekRange('2026-10-10T03:00:00Z', '2026-10-17T03:00:00Z')).toBe('10 a 16 de out.');
    expect(formatWeekRange('2026-09-26T03:00:00Z', '2026-10-03T03:00:00Z')).toBe('26 de set. a 2 de out.');
    // Sexta 23h30 em Brasília já é sábado em UTC.
    expect(isRankingClosingDay(new Date('2026-10-17T02:30:00Z'))).toBe(true);
    expect(isRankingClosingDay(new Date('2026-10-17T03:30:00Z'))).toBe(false);
    expect(rankingDayKey(new Date('2026-10-17T02:30:00Z'))).toBe('2026-10-16');
  });

  it('descreve o mês do ranking e o dia do fechamento no horário de Brasília', () => {
    // 1º/10 00:00 em Brasília = 03:00 UTC.
    expect(formatMonth('2026-10-01T03:00:00Z')).toBe('outubro de 2026');
    expect(formatMonth('2026-10-01T02:30:00Z')).toBe('setembro de 2026');
    // 31/10 23h30 em Brasília já é 1º/11 em UTC: ainda é o último dia do mês.
    expect(isMonthClosingDay(new Date('2026-11-01T02:30:00Z'))).toBe(true);
    expect(isMonthClosingDay(new Date('2026-10-30T15:00:00Z'))).toBe(false);
    expect(isMonthOpeningDay(new Date('2026-11-01T03:30:00Z'))).toBe(true);
    expect(isMonthOpeningDay(new Date('2026-11-01T02:30:00Z'))).toBe(false);
  });

  it('conta os dias até o último dia do período, no horário de Brasília', () => {
    // Semana de 17 a 23/10 (fim exclusivo: sábado 24/10 00:00 BRT = 03:00 UTC).
    const end = '2026-10-24T03:00:00Z';
    expect(daysUntilClose(end, new Date('2026-10-19T14:00:00Z'))).toBe(4);
    expect(daysUntilClose(end, new Date('2026-10-22T14:00:00Z'))).toBe(1);
    expect(daysUntilClose(end, new Date('2026-10-24T02:30:00Z'))).toBe(0);
  });
});
