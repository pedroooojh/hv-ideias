import { Fragment } from 'react';

/**
 * Exibe texto do usuário destacando trechos entre crases como código
 * (ex.: `:data_ini`). Não interpreta HTML: o texto só é dividido e cada parte
 * é renderizada pelo React, que escapa o conteúdo.
 */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/`([^`\n]+)`/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <code
            key={i}
            className="rounded-md border border-brand/10 bg-brand-soft px-1.5 py-0.5 font-mono text-[0.85em] text-navy"
          >
            {part}
          </code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
