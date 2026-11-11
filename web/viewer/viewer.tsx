// An artifact as the person sees it in the web app's viewer, on the machine that keeps it (SHEP-149): herdr-artifact
// preview serves this page on 127.0.0.1 only, with the artifact's recipe and pictures. It draws with the web app's own
// recipe view (screens/Recipe.tsx) and styles, at the web app's device widths (phone under 640 px), so an agent's
// screenshot of it is what the person gets. Choices and forms are disabled here: this is a read-only local view.
import '../src/styles.css'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Recipe, UNREADABLE } from '../src/screens/Recipe.tsx'
import * as R from '@core/recipe.js'
import { deviceFor as deviceOf } from '../src/kernel.ts'

const { withIds } = R as any

type Meta = { kind?: string; id: string; title: string; version: number; versions: { v: number; at: number; note?: string; kind?: string }[] }

const q = new URLSearchParams((window as any).viewerLink ?? location.search)
const id = q.get('artifact') ?? ''
const api = `api/artifacts/${encodeURIComponent(id)}`

/** how long ago, as the web app's viewer says it (plugins/artifacts ago): "just now", "5m ago", "2h ago", "3d ago" */
function ago(ms: number) {
  const m = Math.floor((Date.now() - ms) / 60000)
  if (m < 1) return 'just now'
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`
}

function useDevice() {
  const [d, setD] = useState(() => deviceOf(innerWidth))
  useEffect(() => {
    const on = () => setD(deviceOf(innerWidth))
    addEventListener('resize', on)
    return () => removeEventListener('resize', on)
  }, [])
  return d
}

function Viewer() {
  const device = useDevice()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [recipe, setRecipe] = useState<{ blocks: unknown[] } | null>(null)
  const [picture, setPicture] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetch(api)
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error || 'gone')))))
      .then((m: Meta) => {
        setMeta(m)
        document.title = m.title
        const v = Number(q.get('v')) || m.version
        if ((m.versions.find((x) => x.v === v)?.kind ?? m.kind) === 'custom') {
          setPicture(`${api}/file/.window.png?v=${v}`)
          return null
        }
        return fetch(`${api}/recipe?v=${v}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(UNREADABLE))))
      })
      .then((r) => { if (r) setRecipe(withIds(r)) }, (e: Error) => setError(e.message || UNREADABLE))
  }, [])
  const v = Number(q.get('v')) || meta?.version
  const when = meta?.versions.find((x) => x.v === v)?.at
  return (
    <div data-device={device} className="artifact-viewer">
      <div className="artifact-viewer-bar"><span>BossGoat · Artifacts</span><span>Local · Read only{v ? ` · Version ${v}` : ''}{when ? ` · ${ago(when)}` : ''}</span></div>
      <main className="artifact-viewer-body">
        {error ? <p className="p-6">{error}</p> : picture ? (
          <div className="artifact-document"><h1>{meta?.title}</h1><img src={picture} alt={meta?.title || 'Artifact'} onError={() => setError('No saved picture yet. Open this custom artifact in the desktop app.')} /></div>
        ) : !recipe ? <p className="p-6">Loading…</p> : (
          <Recipe heading={meta?.title} recipe={recipe} asset={(src) => `${api}/file/${src.split('/').map(encodeURIComponent).join('/')}?v=${v}`} />
        )}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Viewer /></StrictMode>)
