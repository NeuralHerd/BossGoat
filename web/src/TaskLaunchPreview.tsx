import { useEffect, useState } from 'react'
import { act } from './kernel.ts'
import type { TaskLaunchPreview as Preview } from '../shared/types.ts'

export function TaskLaunchPreview({ task, note }: { task: string; note: string }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function check() {
    setBusy(true); setError(''); setMessage('')
    try { setPreview(await act({ type: 'task-preview', task }) as Preview) }
    catch (e) { setPreview(null); setError(String(e instanceof Error ? e.message : e)) }
    finally { setBusy(false) }
  }
  useEffect(() => { void check() }, [task])
  async function start() {
    setBusy(true); setError('')
    try {
      const result = await act({ type: 'task-start', task }) as { reason?: string }
      setMessage(result.reason ? `Queued: ${result.reason}` : 'Starting task…')
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); setPreview(null) }
    finally { setBusy(false) }
  }
  return <div className="overflow-y-auto bg-bg p-4 text-fg">
    <p className="mb-3 text-sm">{message || note}</p>
    <section className="rounded-lg border border-line bg-bubble p-4" aria-label="Task launch preview">
      <h3 className="mb-3 font-semibold">Task launch preview</h3>
      {preview?.rows.map(row => <p className="mb-2 text-sm" key={row.label}><strong>{row.label}:</strong> {row.text}</p>)}
      {!preview && !error ? <p>Checking launch settings…</p> : null}
      {[...(preview?.problems || []), ...(error ? [error] : [])].map(text => <p role="alert" className="my-2 text-sm text-need-fg" key={text}>{text}</p>)}
      <div className="mt-3 flex gap-3">
        <button type="button" disabled={busy} onClick={() => void check()} className="rounded border border-line bg-bg px-3 py-2 text-fg disabled:opacity-50">Check again</button>
        <button type="button" disabled={busy || !preview?.ready || Boolean(message)} onClick={() => void start()} className="rounded bg-fg px-3 py-2 text-bg disabled:opacity-50">Start task</button>
      </div>
    </section>
  </div>
}
