import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listKnownRepos, listRepoAliases, resolveRepoAlias } from '../repos'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('registro portable de repos por alias', () => {
  beforeEach(() => {
    vi.stubEnv('BRAIN_REPOS', 'front:/repos/front, work-orders:/repos/work-orders')
  })

  it('parsea BRAIN_REPOS en un mapa alias → ruta', () => {
    expect(listRepoAliases()).toEqual({ front: '/repos/front', 'work-orders': '/repos/work-orders' })
  })

  it('resuelve un alias conocido a su ruta absoluta', () => {
    expect(resolveRepoAlias('front')).toBe('/repos/front')
  })

  it('devuelve la entrada literal si no es un alias conocido (ruta directa)', () => {
    expect(resolveRepoAlias('/otra/ruta')).toBe('/otra/ruta')
  })

  it('lista los alias conocidos con si su carpeta existe', () => {
    const repos = listKnownRepos()
    expect(repos).toHaveLength(2)
    expect(repos.find(r => r.alias === 'front')).toEqual({ alias: 'front', path: '/repos/front', exists: false })
  })

  it('sin BRAIN_REPOS configurado, no hay alias y todo se trata como ruta literal', () => {
    vi.stubEnv('BRAIN_REPOS', '')
    expect(listRepoAliases()).toEqual({})
    expect(resolveRepoAlias('cualquier-cosa')).toBe('cualquier-cosa')
  })
})
