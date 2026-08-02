import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dslOf, CHEATS, EDITABLE, parseMode, setDirective, readDirective } from '../src/client/diagram-editor.js'

describe('dslOf', () => {
  it('reads the dialect off a diagram item first line', () =>
    assert.equal(dslOf({ type: 'diagram', text: 'mermaid\nflowchart TD\n A-->B' }), 'mermaid'))

  it('lowercases and trims the type line', () =>
    assert.equal(dslOf({ type: 'diagram', text: '  GraphViz  \ndigraph{}' }), 'graphviz'))

  it('uses the item type for single-dialect items', () =>
    assert.equal(dslOf({ type: 'svg', text: '<svg/>' }), 'svg'))

  it('handles a diagram item with no text', () =>
    assert.equal(dslOf({ type: 'diagram' }), ''))

  it('handles no item', () => assert.equal(dslOf(null), null))
})

describe('CHEATS', () => {
  it('covers every dialect the editable types can produce', () => {
    for (const dsl of ['mermaid', 'graphviz', 'd2', 'plantuml', 'svg']) {
      assert.ok(Array.isArray(CHEATS[dsl]) && CHEATS[dsl].length, `missing cheats for ${dsl}`)
    }
  })

  it('is a table of [code, note] pairs', () => {
    for (const rows of Object.values(CHEATS)) {
      for (const row of rows) {
        assert.equal(row.length, 2)
        assert.equal(typeof row[0], 'string')
        assert.equal(typeof row[1], 'string')
      }
    }
  })
})

describe('EDITABLE', () => {
  it('includes the diagram family', () =>
    assert.deepEqual(EDITABLE, ['diagram', 'mermaid', 'graphviz', 'svg']))

  it('every editable type that is its own dialect has a cheat-sheet', () => {
    for (const t of EDITABLE) {
      if (t === 'diagram') continue // dialect comes from the first text line
      assert.ok(CHEATS[t], `no cheat-sheet for ${t}`)
    }
  })
})


describe('parseMode', () => {
  it('defaults to edit', () => assert.equal(parseMode(''), 'edit'))
  it('reads MODE tool', () => assert.equal(parseMode('MODE tool'), 'tool'))
  it('accepts the bare TOOL keyword', () => assert.equal(parseMode('TOOL'), 'tool'))
  it('accepts the optional colon', () => assert.equal(parseMode('MODE: tool'), 'tool'))
  // House DSL convention: UPPERCASE is canonical, but input case is forgiven.
  it('forgives lowercase keywords', () => assert.equal(parseMode('mode tool'), 'tool'))
  it('leaves a keyword with no argument as data', () => assert.equal(parseMode('MODE'), 'edit'))
})

describe('setDirective / readDirective', () => {
  const src = 'mermaid\nflowchart TD\n A-->B'

  it('inserts after the type line', () =>
    assert.equal(setDirective(src, 'WIDTH', 'HALF'), 'mermaid\nWIDTH HALF\nflowchart TD\n A-->B'))

  it('replaces rather than duplicates', () => {
    const once = setDirective(src, 'WIDTH', 'HALF')
    const twice = setDirective(once, 'WIDTH', 'FULL')
    assert.equal((twice.match(/WIDTH/g) || []).length, 1)
    assert.equal(readDirective(twice, 'WIDTH'), 'FULL')
  })

  it('uppercases the keyword it writes', () =>
    assert.match(setDirective(src, 'width', 'full'), /^mermaid\nWIDTH full$/m))

  it('reads nothing when absent', () => assert.equal(readDirective(src, 'WIDTH'), null))
})
