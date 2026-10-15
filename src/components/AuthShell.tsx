import { forwardRef, useState, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { CheckCircle2, Eye, EyeOff, Sparkles, Zap } from 'lucide-react';
import { Logo } from './Layout';

/**
 * Layout das telas de autenticação: logo e rodapé à esquerda; o formulário fica
 * centralizado na coluna (tela inteira no celular/tablet; metade esquerda no
 * desktop, ao lado do painel da marca).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[100svh] overflow-hidden">
      <div className="flex w-full flex-col overflow-y-auto px-6 py-8 sm:px-12 lg:w-[45%] lg:px-12 xl:w-1/2 xl:px-20">
        <div className="mt-4 sm:mt-8 lg:mt-12">
          <Logo />
        </div>
        <main id="conteudo" className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[420px] animate-fade-in">{children}</div>
        </main>
        <footer className="text-xs text-muted">© {new Date().getFullYear()} Hubvision Inovação e Negócios</footer>
      </div>
      <BrandPanel />
    </div>
  );
}

/**
 * Mensagem em órbita: um ponto de luz percorre o anel e o nome vai logo acima dele.
 * O braço gira em torno do centro; o nome gira ao contrário e fica sempre na horizontal.
 */
function OrbitChip({ delay, icon, children }: { delay: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="hv-orbit" style={{ '--hv-orbit-delay': delay } as CSSProperties}>
      <div className="hv-orbit-item">
        <span className="hv-orbit-dot" />
        <div className="hv-orbit-upright">
          <span className="hv-orbit-label inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-semibold text-white shadow-[0_8px_24px_-12px_rgb(0_0_0/0.5)] backdrop-blur-md">
            {icon}
            {children}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Anel concêntrico que gira devagar e "respira" de leve. O anel por onde passam
 * os pontos de luz é fixo (`steady`): se ele pulsasse, os pontos sairiam da linha.
 */
function OrbitRing({
  size,
  duration,
  reverse = false,
  strong = false,
  steady = false,
}: {
  size: string;
  duration: string;
  reverse?: boolean;
  strong?: boolean;
  steady?: boolean;
}) {
  return (
    <div
      className={`hv-ring ${steady ? 'hv-ring-steady' : ''} absolute left-0 top-0 rounded-full border ${strong ? 'border-white/15' : 'border-white/10'}`}
      style={
        {
          '--hv-ring-size': size,
          '--hv-ring-duration': duration,
          // Uma direção por animação: o giro pode inverter, a respiração continua indo e voltando.
          animationDirection: reverse ? 'reverse, alternate' : 'normal, alternate',
        } as CSSProperties
      }
    />
  );
}

/** Painel decorativo animado (oculto de leitores de tela; não traz informação necessária para entrar). */
function BrandPanel() {
  return (
    <div aria-hidden className="hv-brand-panel relative hidden overflow-hidden lg:block lg:w-[55%] xl:w-1/2">
      {/* Manchas de luz que flutuam sobre o gradiente em movimento. */}
      <div className="hv-blob hv-blob-1 absolute -left-24 -top-24 h-[460px] w-[460px] rounded-full bg-[#4aa3c4]/45 blur-3xl" />
      <div className="hv-blob hv-blob-2 absolute -bottom-32 -right-24 h-[480px] w-[480px] rounded-full bg-[#3fa0d0]/30 blur-3xl" />
      <div className="hv-blob hv-blob-3 absolute left-1/3 top-1/2 h-[360px] w-[360px] rounded-full bg-[#2f6bff]/25 blur-3xl" />

      {/* Centro das órbitas: anéis e mensagens giram em torno deste ponto. */}
      <div className="hv-orbit-center absolute left-1/2 top-[45%]">
        <OrbitRing size="calc(var(--hv-orbit-r) * 2 + 200px)" duration="90s" reverse />
        <OrbitRing size="calc(var(--hv-orbit-r) * 2)" duration="60s" strong steady />
        <OrbitRing size="calc(var(--hv-orbit-r) * 2 - 140px)" duration="45s" reverse strong />

        {/* Logo + nome formam um bloco único, centralizado no centro dos anéis. */}
        <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2">
          <div className="hv-float flex flex-col items-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-white/30 bg-white/10 shadow-[0_20px_50px_-20px_rgb(0_0_0/0.6)] backdrop-blur-md">
              <img src="/simbolo-hv-branco.png" alt="" className="w-14" />
            </div>
            <p className="mt-5 whitespace-nowrap font-display text-2xl font-bold tracking-tight text-white xl:text-3xl">HubVision</p>
            {/* O espaçamento entre letras também sobra depois da última letra: compensado à esquerda. */}
            <p className="mt-1 whitespace-nowrap pl-[0.35em] text-xs font-bold tracking-[0.35em] text-[#7fd6f2]">HV IDEIAS</p>
          </div>
        </div>

        {/* Três mensagens no mesmo anel, separadas por 120°: nunca se encontram. */}
        <OrbitChip delay="-6s" icon={<Zap className="h-3.5 w-3.5 fill-[#ffd54a] text-[#ffd54a]" />}>
          Inovação Contínua
        </OrbitChip>
        <OrbitChip delay="-26s" icon={<Sparkles className="h-3.5 w-3.5 text-[#ffe08a]" />}>
          Cocriação Ativa
        </OrbitChip>
        <OrbitChip delay="-46s" icon={<CheckCircle2 className="h-4 w-4 text-[#4ade80]" />}>
          Ambiente Seguro
        </OrbitChip>
      </div>

      <p className="absolute inset-x-0 bottom-10 mx-auto max-w-md px-10 text-center text-sm leading-relaxed text-white/80">
        “As melhores ideias nascem da colaboração ativa e ganham forma no Painel de Melhorias.”
      </p>
    </div>
  );
}

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  icon: ReactNode;
  error?: string;
  hint?: string;
  /** Ação ao lado do rótulo (ex.: "Esqueceu a senha?"). */
  labelAction?: ReactNode;
}

/** Campo das telas de autenticação, com ícone à esquerda e mensagem de erro junto ao campo. */
export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField(
  { id, label, icon, error, hint, labelAction, type, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {labelAction}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
          {icon}
        </span>
        <input
          ref={ref}
          id={id}
          type={isPassword && visible ? 'text' : type}
          className={`w-full rounded-xl border bg-subtle py-3 pl-10 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/25 ${
            isPassword ? 'pr-11' : 'pr-3.5'
          } ${error ? 'border-danger' : 'border-transparent'}`}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...props}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted hover:text-ink"
            aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={visible}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
