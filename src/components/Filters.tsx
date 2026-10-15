import { useEffect, useId, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { formatNumber } from '@/lib/format';

// Filtros padronizados de todas as telas. Regras:
//  * o estado vive na URL (?tipo=…&status=…&busca=…): sobrevive a recarregar,
//    pode ser compartilhado e volta igual ao usar o "Voltar";
//  * uma linha só: abas da dimensão principal à esquerda (no máximo uma linha de
//    abas por tela); à direita busca, menus ("Status ▾", "Ordenar ▾") e a ação;
//  * contagens aparecem nas abas (só se > 0) e dentro dos menus, nunca repetidas;
//  * o resumo "N resultados · Limpar filtros" só aparece com filtro ativo.

export interface FilterOption<T extends string = string> {
  value: T | null;
  label: string;
  count?: number;
  /** Marcador à esquerda (ex.: bolinha com a cor do status). */
  marker?: ReactNode;
}

/** Lê e grava filtros na URL (substitui a entrada do histórico, sem criar "voltar" extra). */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const get = (key: K): string | null => params.get(key);
  const set = (key: K, value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const clear = (only: readonly K[] = keys) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        only.forEach((k) => next.delete(k));
        return next;
      },
      { replace: true },
    );
  const active = (only: readonly K[] = keys) => only.some((k) => Boolean(params.get(k)));
  return { get, set, clear, active };
}

/** Lê um valor da URL só se ele for um dos permitidos (URL editada à mão não quebra a tela). */
export function pick<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Linha única de filtros: abas à esquerda, controles à direita. */
export function FilterBar({ tabs, controls }: { tabs?: ReactNode; controls?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">{tabs}</div>
      {controls && <div className="flex flex-wrap items-center gap-2 pb-3">{controls}</div>}
    </div>
  );
}

/** Abas da dimensão principal. A contagem só aparece quando é maior que zero. */
export function FilterTabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FilterOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-7 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0" role="group" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value ?? 'todos'}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-1 pb-3 pt-1 text-[0.9375rem] transition-colors duration-200 ${
              active ? 'border-brand font-bold text-brand' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {o.label}
            {o.count !== undefined && o.count > 0 && (
              <span className={`text-xs font-bold ${active ? 'text-brand' : 'text-muted'}`}>{formatNumber(o.count)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const triggerBase =
  'group inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 text-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

/**
 * Filtro secundário em menu. O botão mostra só o nome ("Status") quando não há
 * filtro, e o valor escolhido ("Status: Em análise") quando há.
 */
export function FilterMenu<T extends string>({
  label,
  options,
  value,
  onChange,
  allLabel = 'Todos',
  showLabelWhenSet = true,
}: {
  label: string;
  options: FilterOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  /** Rótulo da opção "sem filtro"; null quando não existe (ex.: ordenação). */
  allLabel?: string | null;
  showLabelWhenSet?: boolean;
}) {
  const selected = options.find((o) => o.value === value);
  const isFilter = allLabel !== null;
  const highlighted = isFilter && value !== null;
  const text = selected && (value !== null || !isFilter) ? (showLabelWhenSet ? `${label}: ${selected.label}` : selected.label) : label;
  const all: FilterOption<T>[] = isFilter ? [{ value: null, label: allLabel }, ...options] : options;
  const hasMarkers = options.some((o) => o.marker);
  const heading = isFilter ? `Filtrar por ${label.toLocaleLowerCase('pt-BR')}` : `${label} por`;

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className={`${triggerBase} ${
          highlighted ? 'border-brand bg-brand-soft font-semibold text-brand' : 'border-line bg-surface text-ink hover:border-brand/40'
        }`}
        aria-label={`${label}${selected && value !== null ? `: ${selected.label}` : ''}`}
      >
        {text}
        <ChevronDown className="h-4 w-4 text-muted transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="animate-presence z-50 min-w-[14rem] overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-float"
        >
          <Menu.Label className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-muted">{heading}</Menu.Label>
          <Menu.RadioGroup value={value ?? '__all__'} onValueChange={(v) => onChange(v === '__all__' ? null : (v as T))}>
            {all.map((o) => (
              <Menu.RadioItem
                key={o.value ?? '__all__'}
                value={o.value ?? '__all__'}
                className="flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors duration-150 data-[highlighted]:bg-subtle data-[state=checked]:text-brand"
              >
                {hasMarkers && <span className="flex w-2.5 shrink-0 justify-center">{o.marker}</span>}
                <span className="flex-1 font-medium">{o.label}</span>
                {o.count !== undefined && <span className="text-xs tabular-nums text-muted">{formatNumber(o.count)}</span>}
                <span className="flex w-4 shrink-0 justify-center">
                  <Menu.ItemIndicator>
                    <Check className="h-4 w-4" aria-hidden />
                  </Menu.ItemIndicator>
                </span>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Ordenação no mesmo formato dos filtros: "Ordenar: Ranking ▾". */
export function SortMenu<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <FilterMenu<T>
      label="Ordenar"
      allLabel={null}
      value={value}
      onChange={(v) => v && onChange(v)}
      options={options.map((o) => ({ value: o.value, label: o.label }))}
    />
  );
}

/** Busca compacta com espera de digitação; reflete a URL (limpar filtros zera o campo). */
export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder: string;
  label: string;
}) {
  const id = useId();
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  useEffect(() => {
    const term = text.trim() || null;
    if (term === (value ?? null)) return;
    const t = window.setTimeout(() => onChange(term), 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div className="relative w-full sm:w-56">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        id={id}
        type="search"
        className="field-input h-9 py-0 pl-9"
        placeholder={placeholder}
        value={text}
        maxLength={100}
        onChange={(e) => setText(e.target.value)}
      />
    </div>
  );
}

export function ClearFilters({ visible, onClear }: { visible: boolean; onClear: () => void }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1 text-sm font-semibold text-brand transition-colors duration-200 hover:text-brand-strong"
    >
      <X className="h-4 w-4" aria-hidden /> Limpar filtros
    </button>
  );
}

/** Resumo só quando há filtro ativo: "N resultados · Limpar filtros". */
export function FilterSummary({
  active,
  total,
  onClear,
}: {
  active: boolean;
  total: number | undefined;
  onClear: () => void;
}) {
  if (!active || total === undefined) return null;
  return (
    <p className="mt-3 flex items-center gap-3 text-sm text-muted" aria-live="polite">
      <span>
        {formatNumber(total)} {total === 1 ? 'resultado' : 'resultados'}
      </span>
      <span aria-hidden>·</span>
      <ClearFilters visible onClear={onClear} />
    </p>
  );
}
