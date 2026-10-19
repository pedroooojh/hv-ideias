// Rótulos e estilos dos estados do domínio. Os valores são os mesmos aceitos
// pelas restrições do banco (supabase/migrations).

export type SuggestionStatus = 'em_analise' | 'planejado' | 'em_desenvolvimento' | 'implementado' | 'nao_aprovado';
export type ProjectStatus = 'em_avaliacao' | 'planejado' | 'em_desenvolvimento' | 'concluido' | 'arquivado';
export type SortOrder = 'ranking' | 'recentes';

interface StatusStyle {
  label: string;
  /** classes do chip (fundo + texto) */
  chip: string;
  /** classe do ponto colorido */
  dot: string;
}

export const SUGGESTION_STATUS: Record<SuggestionStatus, StatusStyle> = {
  em_analise: { label: 'Em análise', chip: 'bg-teal-soft text-teal', dot: 'bg-teal' },
  planejado: { label: 'Planejado', chip: 'bg-brand-soft text-brand', dot: 'bg-brand' },
  em_desenvolvimento: { label: 'Em desenvolvimento', chip: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  implementado: { label: 'Implementado', chip: 'bg-success/10 text-success', dot: 'bg-success' },
  nao_aprovado: { label: 'Não aprovado', chip: 'bg-danger/10 text-danger', dot: 'bg-danger' },
};

export const SUGGESTION_STATUS_ORDER: SuggestionStatus[] = [
  'em_analise',
  'planejado',
  'em_desenvolvimento',
  'implementado',
  'nao_aprovado',
];

export const PROJECT_STATUS: Record<ProjectStatus, StatusStyle> = {
  em_avaliacao: { label: 'Em avaliação', chip: 'bg-success/10 text-success', dot: 'bg-success' },
  planejado: { label: 'Planejado', chip: 'bg-brand-soft text-brand', dot: 'bg-brand' },
  em_desenvolvimento: { label: 'Em desenvolvimento', chip: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  concluido: { label: 'Concluído', chip: 'bg-teal-soft text-teal', dot: 'bg-teal' },
  arquivado: { label: 'Arquivado', chip: 'bg-subtle text-muted', dot: 'bg-muted' },
};

/** Explicação curta de cada status, mostrada ao escolher o status de um projeto. */
export const PROJECT_STATUS_HINT: Record<ProjectStatus, string> = {
  em_avaliacao: 'Recebendo ideias e votos da equipe',
  planejado: 'Aprovado e aguardando início',
  em_desenvolvimento: 'Sendo construído agora',
  concluido: 'Entregue; ainda aceita sugestões',
  arquivado: 'Visível, mas sem novas sugestões ou votos',
};

export const PROJECT_STATUS_ORDER: ProjectStatus[] = [
  'em_avaliacao',
  'planejado',
  'em_desenvolvimento',
  'concluido',
  'arquivado',
];

/** Estilo do chip de tipo. Tipos novos (cadastrados no banco) usam o estilo padrão. */
export function typeChipClass(slug: string): string {
  if (slug === 'melhoria') return 'bg-subtle text-ink';
  if (slug === 'nova_funcionalidade') return 'bg-brand-soft text-brand';
  return 'bg-teal-soft text-teal';
}

// Pontuação. O cálculo é feito no banco (private.score_events); aqui só para textos.
/** Cada voto positivo válido recebido vale 1 ponto para o autor da sugestão. */
export const POINTS_PER_VOTE = 1;
/** Publicar uma sugestão vale 0,5 ponto, para incentivar novas ideias. */
export const POINTS_PER_SUGGESTION = 0.5;
/** Status que contam como "selecionada pela administração": os pontos da ideia dobram. */
export const SELECTED_STATUSES: SuggestionStatus[] = ['planejado', 'em_desenvolvimento', 'implementado'];

/** Mesmos limites validados no banco, para feedback imediato nos formulários. */
export const LIMITS = {
  suggestionTitle: { min: 5, max: 150 },
  suggestionDescription: { min: 10, max: 5000 },
  comment: { min: 1, max: 2000 },
  projectName: { min: 3, max: 120 },
  projectDescription: { min: 10, max: 4000 },
  projectCategory: { min: 2, max: 60 },
  statusReason: { min: 5, max: 1000 },
  profileName: { min: 2, max: 80 },
} as const;

/** Valida comprimento de texto (após remover espaços nas pontas). Retorna a mensagem de erro ou null. */
export function lengthError(value: string, field: string, limits: { min: number; max: number }): string | null {
  const length = value.trim().length;
  if (length === 0) return `${field} é obrigatório.`;
  if (length < limits.min) return `${field} deve ter pelo menos ${limits.min} caracteres.`;
  if (length > limits.max) return `${field} deve ter no máximo ${limits.max} caracteres.`;
  return null;
}
