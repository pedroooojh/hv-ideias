import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

// Listas de escolha padronizadas (substituem o <select> e o <datalist> nativos):
// mesmo visual dos campos e menus do site, opções com descrição curta e marcador,
// fade ao abrir e fechar, e navegação completa por teclado e leitor de tela.

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Frase curta que explica a opção. */
  description?: string;
  /** Marcador à esquerda (ex.: bolinha com a cor do status). */
  marker?: ReactNode;
}

const panel = 'animate-presence z-[70] overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-float';
const itemBase =
  'relative flex cursor-default select-none items-start gap-2.5 rounded-md py-2 pl-2.5 pr-8 text-sm text-ink outline-none transition-colors duration-150';

export function Select<T extends string>({
  id,
  value,
  onChange,
  options,
  placeholder = 'Selecione',
  disabled,
  compact = false,
  className = '',
  ...aria
}: {
  id?: string;
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  /** Versão menor, para usar em linhas de tabela/lista. */
  compact?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  const selected = options.find((o) => o.value === value);
  return (
    <RadixSelect.Root value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        {...aria}
        className={`group inline-flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface text-left text-ink transition-colors duration-200 hover:border-brand/40 focus:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line data-[state=open]:border-brand ${
          compact ? 'h-9 px-3 text-sm' : 'px-3.5 py-2.5 text-sm'
        } ${className}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.marker}
          <span className="truncate">
            <RadixSelect.Value placeholder={placeholder}>{selected?.label}</RadixSelect.Value>
          </span>
        </span>
        <RadixSelect.Icon asChild>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className={`${panel} max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)]`}
        >
          <RadixSelect.Viewport>
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={o.value}
                className={`${itemBase} data-[highlighted]:bg-subtle data-[state=checked]:text-brand`}
              >
                {o.marker && <span className="mt-1.5 shrink-0">{o.marker}</span>}
                <span className="min-w-0">
                  <RadixSelect.ItemText>
                    <span className="font-medium">{o.label}</span>
                  </RadixSelect.ItemText>
                  {o.description && <span className="mt-0.5 block text-xs text-muted">{o.description}</span>}
                </span>
                <RadixSelect.ItemIndicator className="absolute right-2.5 top-2.5">
                  <Check className="h-4 w-4" aria-hidden />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

/** Bolinha colorida usada como marcador de status nas opções. */
export function Dot({ className }: { className: string }) {
  return <span className={`block h-2.5 w-2.5 rounded-full ${className}`} aria-hidden />;
}

/**
 * Campo de texto livre com sugestões (substitui o <datalist>): mostra as opções
 * já usadas que combinam com o que foi digitado; ↑/↓ navegam, Enter escolhe,
 * Esc fecha. Segue o padrão ARIA de combobox com lista.
 */
export function ComboField({
  id,
  value,
  onChange,
  suggestions,
  placeholder,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const closeTimer = useRef<number>();

  const matches = useMemo(() => {
    const term = value.trim().toLocaleLowerCase('pt-BR');
    return suggestions
      .filter((s) => s.toLocaleLowerCase('pt-BR') !== term && s.toLocaleLowerCase('pt-BR').includes(term))
      .slice(0, 8);
  }, [suggestions, value]);
  const visible = open && matches.length > 0;

  // Esc com a lista aberta fecha só a lista. O modal em volta (Radix) escuta o
  // Esc no document; a captura na window chega antes e impede que ele feche.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [visible]);

  const choose = (s: string) => {
    onChange(s);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!matches.length) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + matches.length) % matches.length);
    } else if (e.key === 'Enter' && visible && active >= 0) {
      e.preventDefault();
      choose(matches[active]);
    }
  };

  return (
    <div className="relative">
      <input
        id={id}
        className="field-input"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          closeTimer.current = window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={listId}
        aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
      {visible && (
        <ul id={listId} role="listbox" className={`${panel} absolute inset-x-0 top-full mt-1.5 max-h-60 animate-fade-in overflow-y-auto`}>
          <li className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-muted" aria-hidden>
            Categorias já usadas
          </li>
          {matches.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                window.clearTimeout(closeTimer.current);
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`${itemBase} pr-2.5 ${i === active ? 'bg-subtle' : ''}`}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
