import { PageContainer } from '@/components/ui';
import { usePageTitle } from '@/lib/navigation';
import { SUGGESTION_STATUS, SUGGESTION_STATUS_ORDER } from '@/lib/domain';

const STATUS_TEXT: Record<string, string> = {
  em_analise: 'A sugestão está sendo avaliada pela equipe. O autor ainda pode editá-la ou excluí-la.',
  planejado: 'A ideia foi selecionada para execução futura.',
  em_desenvolvimento: 'A implementação já começou.',
  implementado: 'A melhoria foi concluída. A votação é encerrada.',
  nao_aprovado: 'A ideia foi avaliada, mas não será executada. A equipe publica a justificativa.',
};

export function GuidelinesPage() {
  usePageTitle('Diretrizes');
  return (
    <PageContainer narrow back={{ to: '/', label: 'Início' }}>
      <article className="max-w-4xl">
        <h1 className="text-4xl font-bold tracking-tight text-ink">Diretrizes da comunidade</h1>
        <p className="mt-4 text-lg text-muted">
          A plataforma de ideias da Hubvision reúne sugestões de melhoria e novas funcionalidades para os nossos projetos.
          Estas regras valem para todos os participantes.
        </p>

        <section className="card mt-8 space-y-3 p-6 sm:p-8">
          <h2 className="text-xl font-bold text-ink">Votos e pontuação</h2>
          <ul className="list-disc space-y-2 pl-5 text-muted">
            <li>Cada pessoa pode dar no máximo um voto positivo em cada sugestão e pode retirá-lo quando quiser.</li>
            <li>Não é possível votar na própria sugestão.</li>
            <li>
              Publicar uma sugestão vale <strong className="text-ink">0,5 ponto</strong> e cada voto positivo válido recebido
              vale <strong className="text-ink">1 ponto</strong> para o autor. Comentar não gera pontos.
            </li>
            <li>
              Quando a equipe seleciona a ideia (status Planejado, Em desenvolvimento ou Implementado), os pontos dela{' '}
              <strong className="text-ink">dobram</strong>: o autor recebe de novo o que ela já tinha e cada voto seguinte vale 2
              pontos. Se ela voltar para Em análise ou Não aprovado, o dobro deixa de contar.
            </li>
            <li>Votos retirados e sugestões excluídas deixam de contar pontos.</li>
            <li>
              O ranking da semana (sábado a sexta) mostra o pódio na sexta-feira. O ranking que vale prêmio é o do mês: no
              último dia, às 23h59 (horário de Brasília), quem estiver em 1º lugar é o campeão do mês.
            </li>
            <li>
              Os votos medem o interesse da comunidade; a decisão de executar uma ideia é da equipe responsável pelo projeto.
            </li>
          </ul>
        </section>

        <section className="card mt-6 p-6 sm:p-8">
          <h2 className="text-xl font-bold text-ink">Ciclo de vida de uma sugestão</h2>
          <dl className="mt-4 space-y-4">
            {SUGGESTION_STATUS_ORDER.map((s) => (
              <div key={s} className="flex gap-3">
                <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${SUGGESTION_STATUS[s].dot}`} aria-hidden />
                <div>
                  <dt className="font-semibold text-ink">{SUGGESTION_STATUS[s].label}</dt>
                  <dd className="text-muted">{STATUS_TEXT[s]}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>

        <section className="card mt-6 space-y-3 p-6 sm:p-8">
          <h2 className="text-xl font-bold text-ink">Discussões</h2>
          <ul className="list-disc space-y-2 pl-5 text-muted">
            <li>Comente com respeito e foco na ideia. Conteúdos inadequados podem ser removidos pela moderação.</li>
            <li>Você pode editar e excluir os seus próprios comentários. Comentários removidos ficam sinalizados na conversa.</li>
            <li>Seu e-mail nunca é exibido publicamente; apenas o nome escolhido no seu perfil.</li>
          </ul>
        </section>
      </article>
    </PageContainer>
  );
}
