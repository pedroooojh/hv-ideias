import type { ReactNode } from 'react';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, Lightbulb, LogOut, ScrollText, Search, UserRound, Users } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar, toneFor } from './ui';

const itemClass =
  'flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors duration-150 data-[highlighted]:bg-subtle';

function MenuLink({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Menu.Item asChild>
      <Link to={to} className={itemClass}>
        <span className="text-muted" aria-hidden>
          {icon}
        </span>
        {children}
      </Link>
    </Menu.Item>
  );
}

/**
 * Menu da conta no cabeçalho (foto ou ícone): perfil, perfil público e sair.
 * Para administradores, também os atalhos da Gestão da plataforma.
 */
export function UserMenu({ className, onOpenSearch }: { className: string; onOpenSearch: () => void }) {
  const { profile, user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className={className} aria-label={`Menu da conta (${profile?.name ?? 'conta'})`} title="Minha conta">
        {profile?.avatar_path ? (
          <Avatar name={profile.name} photo={profile.avatar_path} tone={toneFor(profile.name)} />
        ) : (
          <UserRound className="h-5 w-5" />
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="animate-presence z-50 w-64 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-float focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        >
          {profile && (
            <div className="flex items-center gap-3 px-2.5 pb-2.5 pt-1.5">
              <Avatar name={profile.name} photo={profile.avatar_path} size="md" tone={toneFor(profile.name)} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{profile.name}</p>
                <p className="truncate text-xs text-muted">{user?.email}</p>
              </div>
            </div>
          )}
          <Menu.Separator className="my-1 h-px bg-line" />
          <MenuLink to="/perfil" icon={<UserRound className="h-4 w-4" />}>
            Meu perfil
          </MenuLink>
          {profile && (
            <MenuLink to={`/pessoas/${profile.id}`} icon={<Eye className="h-4 w-4" />}>
              Ver meu perfil público
            </MenuLink>
          )}
          <Menu.Item className={itemClass} onSelect={onOpenSearch}>
            <Search className="h-4 w-4 text-muted" aria-hidden /> Buscar sugestões
          </Menu.Item>

          {isAdmin && (
            <>
              <Menu.Separator className="my-1 h-px bg-line" />
              <Menu.Label className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                Gestão da plataforma
              </Menu.Label>
              <MenuLink to="/admin?aba=sugestoes" icon={<Lightbulb className="h-4 w-4" />}>
                Sugestões para analisar
              </MenuLink>
              <MenuLink to="/admin?aba=usuarios" icon={<Users className="h-4 w-4" />}>
                Usuários e convites
              </MenuLink>
              <MenuLink to="/admin?aba=auditoria" icon={<ScrollText className="h-4 w-4" />}>
                Auditoria
              </MenuLink>
            </>
          )}

          <Menu.Separator className="my-1 h-px bg-line" />
          <Menu.Item
            className={`${itemClass} text-danger data-[highlighted]:bg-danger/10`}
            onSelect={async () => {
              // Sai da rota protegida antes de encerrar a sessão, para não cair na tela de login.
              navigate('/', { replace: true });
              await signOut();
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sair
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
