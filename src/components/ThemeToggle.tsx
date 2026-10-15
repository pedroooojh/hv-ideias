import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';

function readTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);
  const next = theme === 'dark' ? 'light' : 'dark';

  const toggle = () => {
    document.documentElement.classList.toggle('dark', next === 'dark');
    setTheme(next);
    // Só grava quando a pessoa escolhe; sem escolha, segue o tema do sistema.
    try {
      localStorage.setItem('hv-theme', next);
    } catch {
      // armazenamento indisponível (modo privado): o tema vale só para esta visita
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      aria-label={next === 'dark' ? 'Ativar tema escuro' : 'Ativar tema claro'}
      title={next === 'dark' ? 'Tema escuro' : 'Tema claro'}
    >
      {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
