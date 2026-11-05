import { describe, expect, it } from 'vitest'
import { eventsWindow, normalizeEvent, type GitLabRawEvent } from '../gitlab'
import { normalizeTask } from '../tasks'

const BASE = 'https://gitlab.com'
const REPO = 'gglobal/wms/front/internal'

function push(overrides: Partial<GitLabRawEvent> = {}): GitLabRawEvent {
  return {
    id: 1,
    created_at: '2026-11-04T23:30:00.000Z',
    action_name: 'pushed to',
    project_id: 7,
    push_data: { ref: 'feat/GCD-1433-bulto', commit_title: 'ajusta pantalla', commit_to: 'abc', commit_count: 3 },
    ...overrides,
  }
}

describe('normalizeEvent', () => {
  it('descarta borrados de rama: no son trabajo nuevo', () => {
    expect(normalizeEvent(push({ action_name: 'deleted' }), REPO, BASE)).toBeNull()
  })

  it('en un push la clave sale de la rama y cuenta los commits', () => {
    const event = normalizeEvent(push(), REPO, BASE)
    expect(event).toMatchObject({
      issueKey: 'GCD-1433',
      commits: 3,
      title: 'ajusta pantalla',
      url: `${BASE}/${REPO}/-/commit/abc`,
    })
  })

  it('una rama nueva sin commits se titula con la rama y enlaza al árbol', () => {
    const event = normalizeEvent(
      push({ action_name: 'pushed new', push_data: { ref: 'dev', commit_count: 0 } }),
      REPO,
      BASE,
    )
    expect(event).toMatchObject({ title: 'dev', url: `${BASE}/${REPO}/-/tree/dev`, issueKey: null, commits: 0 })
  })

  it('en un MR la clave sale del título y enlaza al MR', () => {
    const event = normalizeEvent(
      {
        id: 2,
        created_at: '2026-11-04T10:00:00.000Z',
        action_name: 'accepted',
        target_type: 'MergeRequest',
        target_iid: 3115,
        target_title: 'GCD-1471: condición para Rockwell',
      },
      REPO,
      BASE,
    )
    expect(event).toMatchObject({
      issueKey: 'GCD-1471',
      url: `${BASE}/${REPO}/-/merge_requests/3115`,
    })
  })

  it('sin clave reconocible queda sin correlacionar, no se adivina', () => {
    const event = normalizeEvent(
      push({ push_data: { ref: 'hotfix/urgente', commit_title: 'arregla', commit_to: 'x' } }),
      REPO,
      BASE,
    )
    expect(event?.issueKey).toBeNull()
  })

  it('no inventa un enlace cuando el proyecto no se pudo resolver', () => {
    expect(normalizeEvent(push(), 'proyecto 7', BASE)?.url).toBe('')
  })
})

describe('eventsWindow', () => {
  const now = new Date('2026-11-04T12:00:00.000Z')

  it('sin caché pide la ventana completa', () => {
    const { after, windowStart } = eventsWindow(null, now)
    expect(windowStart).toBe('2025-10-28T12:00:00.000Z')
    // `after` es exclusivo: un día antes para no perder el primero.
    expect(after).toBe('2025-10-27')
  })

  it('con caché sólo pide lo nuevo, con solape', () => {
    expect(eventsWindow('2026-11-04T09:00:00.000Z', now).after).toBe('2026-11-02')
  })

  it('una caché más vieja que la ventana no pide de más', () => {
    expect(eventsWindow('2020-01-01T00:00:00.000Z', now).after).toBe('2025-10-27')
  })

  it('una fecha ilegible se trata como caché vacía', () => {
    expect(eventsWindow('ayer', now).after).toBe('2025-10-27')
  })
})

describe('normalizeTask', () => {
  it('mapea la categoría de estado de Jira', () => {
    const task = (key: string) =>
      normalizeTask({ key: 'GCD-1', fields: { status: { name: 'X', statusCategory: { key } } } }, 'j.net')
    expect(task('done').category).toBe('done')
    expect(task('indeterminate').category).toBe('in_progress')
    expect(task('new').category).toBe('todo')
  })

  it('un ticket abierto no tiene fecha de resolución ni asignado inventado', () => {
    const task = normalizeTask({ key: 'GCD-2', fields: { summary: 'Algo', resolutiondate: null } }, 'j.net')
    expect(task).toMatchObject({
      title: 'Algo',
      resolvedAt: null,
      assignee: null,
      url: 'https://j.net/browse/GCD-2',
    })
  })
})
