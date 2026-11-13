import { dependencyLevels, dependencyLabel, dependencyStatus } from '@core/task-dependencies.js'
import type { Task } from '@shared/types.ts'

export function Dependencies({ tasks, selected, open, results }: {
  tasks: Task[]; selected: Task[]; open: (task: Task) => void; results: (id: string) => void
}) {
  const nodes = tasks.map(t => ({ ...t, key: t.dependencyKey ?? t.id, dependencies: t.dependencies ?? [] }))
  const graph = dependencyLevels(nodes, selected.map(t => t.dependencyKey ?? t.id)) as { levels: typeof nodes[]; loops: typeof nodes }
  const chosen = new Set(selected.map(t => t.id))
  const known = new Map(nodes.map(t => [t.key, t]))
  const button = 'rounded px-2 py-1 text-left text-sm text-fg hover:bg-hover focus-visible:outline focus-visible:outline-2'
  const card = (t: typeof nodes[number]) => <article key={t.key} className="space-y-2 rounded-lg border border-line bg-bubble p-3">
    <p className="text-xs text-fg3">{t.id} · {t.listName || t.place || t.on}{!chosen.has(t.id) ? ' · Prerequisite' : ''}</p>
    <button type="button" className={button + ' font-semibold'} onClick={() => open(t)}>{t.name}</button>
    <p className={'text-sm ' + (t.state === 'needs' ? 'text-need-fg' : 'text-fg2')}>{dependencyStatus(t)}</p>
    {t.skill || t.workerAgent ? <p className="text-xs text-fg3">{[t.skill, t.workerAgent].filter(Boolean).join(' · ')}</p> : null}
    {t.report?.progress != null ? <p className="text-xs text-fg2">{t.report.progress}% complete</p> : null}
    {t.dependencies.length ? <ul className="space-y-1">{t.dependencies.map((d, i) => {
      const target = d.key ? known.get(d.key) : null
      const text = `← ${d.ref} · ${dependencyLabel(d)}`
      return <li key={i}>{target ? <button type="button" className={button} onClick={() => open(target)}>{text}</button>
        : <span className={'text-xs ' + (d.error || d.state === 'unknown' ? 'text-need-fg' : 'text-fg3')}>{text}</span>}</li>
    })}</ul> : null}
    <div className="flex gap-2">
      <button type="button" className={button} onClick={() => open(t)}>Open task</button>
      {t.proof || t.artifacts?.length ? <button type="button" className={button} onClick={() => results(t.proof || t.artifacts![0])}>Results</button> : null}
    </div>
  </article>
  return <div className="space-y-4 p-3" aria-label="Task dependencies">
    <p className="text-xs text-fg3">Tasks in the same step have no dependency on each other. Approvals and capacity can still delay a start. Select a prerequisite to open it. Completed tasks appear as prerequisites or in search.</p>
    {!graph.levels.length && !graph.loops.length ? <p className="py-4 text-sm text-fg3">No tasks match this view.</p> : null}
    {graph.levels.map((level, i) => <section key={i} className="space-y-2">
      <h3 className="text-sm font-semibold text-fg2">{i ? '↓ ' : ''}Step {i + 1} · {level.length} task{level.length === 1 ? '' : 's'}</h3>
      {level.map(card)}
    </section>)}
    {graph.loops.length ? <section className="space-y-2">
      <h3 className="text-sm text-need-fg">Dependency loop: these tasks are in or depend on a loop. Check their prerequisites.</h3>
      {graph.loops.map(card)}
    </section> : null}
  </div>
}
