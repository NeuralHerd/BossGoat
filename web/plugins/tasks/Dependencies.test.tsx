import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Dependencies } from './Dependencies.tsx'
import type { Task } from '@shared/types.ts'

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, dependencyKey: id, name: id, status: 'queued', state: 'queued', place: 'app', on: 'local', age: '', created: '', ...extra })
test('the dependency view explains blockers and retains context outside a filter', () => {
  const root = task('APP-1', { name: 'Foundation', state: 'done' })
  const selected = task('APP-2', { name: 'Feature', dependencies: [{ key: 'APP-1', ref: 'APP-1', state: 'done' }], skill: 'hc-build', workerAgent: 'Cursor', report: { msg: 'Building', progress: 35 }, proof: 'result-1' })
  const html = renderToStaticMarkup(<Dependencies tasks={[root, selected]} selected={[selected]} open={() => {}} results={() => {}} />)
  for (const text of ['Foundation', 'Prerequisite', 'Feature', 'Step 2', 'hc-build', 'Cursor', '35% complete', 'Results', 'Complete']) expect(html).toContain(text)
})
test('missing dependencies and cycles stay visible instead of showing a misleading empty view', () => {
  const a = task('APP-1', { dependencies: [{ key: 'APP-2', ref: 'APP-2', state: 'queued' }, { key: null, ref: 'vm:OTHER-1', state: 'unknown', error: 'Machine offline' }] })
  const b = task('APP-2', { dependencies: [{ key: 'APP-1', ref: 'APP-1', state: 'queued' }] })
  const html = renderToStaticMarkup(<Dependencies tasks={[a, b]} selected={[a]} open={() => {}} results={() => {}} />)
  expect(html).toContain('Dependency loop')
  expect(html).toContain('Machine offline')
  expect(html).not.toContain('No tasks match')
})
