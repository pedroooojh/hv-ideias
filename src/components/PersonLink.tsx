import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Nome (ou foto) que leva ao perfil público; sem id (ex.: comentário removido) vira texto. */
export function PersonLink({
  id,
  children,
  className = '',
  onClick,
}: {
  id: string | null | undefined;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  if (!id) return <span className={className}>{children}</span>;
  return (
    <Link to={`/pessoas/${id}`} onClick={onClick} className={`${className} transition-colors duration-200 hover:text-brand`}>
      {children}
    </Link>
  );
}
