import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { RichText } from '../RichText';

describe('RichText', () => {
  it('destaca trechos entre crases como código', () => {
    const { container } = render(<RichText text="Inserir `:data_ini` e `:data_fim` no filtro" />);
    expect([...container.querySelectorAll('code')].map((c) => c.textContent)).toEqual([':data_ini', ':data_fim']);
    expect(container.textContent).toBe('Inserir :data_ini e :data_fim no filtro');
  });

  it('não interpreta HTML enviado pelo usuário', () => {
    const { container } = render(<RichText text={'<img src=x onerror="alert(1)"> `<b>x</b>`'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('code')?.textContent).toBe('<b>x</b>');
  });

  it('mantém crases sem par como texto comum', () => {
    const { container } = render(<RichText text="custo de 5` por item" />);
    expect(container.querySelector('code')).toBeNull();
    expect(container.textContent).toBe('custo de 5` por item');
  });
});
