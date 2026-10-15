// wiki-plugin-diagram-editor — a tool page for editing the diagram beside it.
//
// The subject is not passed in. A wiki link cannot carry a parameter, so the tool
// works out on arrival which item summoned it: `consumes` names the candidate items
// to its left in the lineup, and the click recorder says which one was clicked.
// See @fortyfoxes/wiki-toolcontext.

import {
  installClickRecorder, resolveSubject, chooseSubject, subjectNote,
  saveSubject, saveBlockers, saveWarnings, rerenderItem, editState,
} from '@fortyfoxes/wiki-toolcontext'
import { fetchKroki, sanitizeSVG } from '@fortyfoxes/wiki-capsule'

// The item types this tool can edit. Also the `consumes` selectors below.
export const EDITABLE = ['diagram', 'mermaid', 'graphviz', 'svg']

const REDRAW_MS = 300

// The item's own directives. MODE picks what this item is: an editor (default) or
// the inspector sketch. A second item TYPE would not work — wiki-server only serves
// /plugins/<type>/<type>.js for the package's own name, so a page holding only the
// second type 404s. One type, one bundle, a directive to choose.
export const parseMode = text => {
  let mode = 'edit'
  for (const raw of (text || '').split('\n')) {
    const [head, ...args] = raw.trim().split(/\s+/)
    const key = (head || '').replace(/:$/, '').toUpperCase()
    if (key === 'MODE' && args.length) mode = args[0].toLowerCase()
    else if (key === 'TOOL') mode = 'tool'
  }
  return mode
}

/** Add or replace a directive line in a diagram item's text. */
export const setDirective = (text, key, value) => {
  const lines = (text || '').split('\n').filter(l => {
    const [h] = l.trim().split(/\s+/)
    return (h || '').replace(/:$/, '').toUpperCase() !== key.toUpperCase()
  })
  lines.splice(1, 0, `${key.toUpperCase()} ${value}`)
  return lines.join('\n')
}

export const readDirective = (text, key) => {
  for (const raw of (text || '').split('\n')) {
    const [head, ...args] = raw.trim().split(/\s+/)
    if ((head || '').replace(/:$/, '').toUpperCase() === key.toUpperCase() && args.length) return args[0]
  }
  return null
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ── Syntax help ───────────────────────────────────────────────────────────────
// A `diagram` item names its own dialect on the first line; every other type is
// its own dialect.
export const dslOf = item => {
  if (!item) return null
  if (item.type === 'diagram') return ((item.text || '').split('\n')[0] || '').trim().toLowerCase()
  return item.type
}

export const CHEATS = {
  mermaid: [
    ['flowchart TD', 'top-down graph; LR for left-right'],
    ['A[Box] --> B(Round)', 'node shapes and an arrow'],
    ['A -->|label| B', 'labelled edge'],
    ['subgraph Name … end', 'group nodes'],
    ['TITLE false', 'this plugin: hide subgraph titles'],
    ['sequenceDiagram', 'other modes: classDiagram, gantt, erDiagram'],
  ],
  graphviz: [
    ['digraph { … }', 'directed; graph { } for undirected'],
    ['a -> b', 'edge (-- when undirected)'],
    ['a [label="Text" shape=box]', 'node attributes'],
    ['rankdir=LR', 'lay out left to right'],
    ['subgraph cluster_x { … }', 'boxed group — the cluster_ prefix matters'],
  ],
  d2: [
    ['a -> b: label', 'edge with a label'],
    ['x: {shape: circle}', 'node attributes'],
    ['group: { a -> b }', 'nesting makes a container'],
    ['direction: right', 'layout direction'],
  ],
  plantuml: [
    ['@startuml … @enduml', 'required wrapper'],
    ['Alice -> Bob: Hello', 'sequence message'],
    ['class Foo { +bar() }', 'class diagram'],
    ['skinparam monochrome true', 'styling'],
  ],
  svg: [
    ['<svg viewBox="0 0 W H">', 'always give a viewBox so it scales'],
    ['<text x= y=>', 'labels matching a page title become links'],
    ['sanitised on render', 'script and event attributes are stripped'],
  ],
}

const cheatFor = dsl => CHEATS[dsl] || null

// Plugin directives, not dialect syntax — they belong to the diagram item itself
// and are stripped before the source reaches the renderer.
export const DIRECTIVES = [
  ['WIDTH NATURAL', 'never bigger than the diagram\'s own size (default)'],
  ['WIDTH FULL', 'stretch to the full column width'],
  ['WIDTH HALF', 'half the column width'],
  ['WIDTH 320', 'cap at an explicit pixel width'],
  ['ALIGN CENTRE', 'centred in the column (default)'],
  ['ALIGN LEFT', 'flush left — the old look'],
  ['ALIGN RIGHT', 'flush right'],
  ['TITLE false', 'hide mermaid subgraph titles'],
]

const table = rows => `<table style="border-collapse:collapse;font-size:11px;width:100%;">${rows.map(([code, note]) => `
    <tr>
      <td style="padding:2px 8px 2px 0;white-space:nowrap;font-family:monospace;color:#333;vertical-align:top;">${esc(code)}</td>
      <td style="padding:2px 0;color:#777;">${esc(note)}</td>
    </tr>`).join('')}</table>`

const cheatHtml = (dsl, item) => {
  const rows = cheatFor(dsl)
  const syntax = rows
    ? table(rows)
    : `<p style="margin:0;color:#999;font-size:11px;">No cheat-sheet for <code>${esc(dsl || 'this type')}</code>.</p>`
  if (!item || item.type !== 'diagram') return syntax
  return `${syntax}
    <p style="margin:8px 0 3px;color:#666;font-size:11px;">Directives — put on their own line, above the source:</p>
    ${table(DIRECTIVES)}`
}

// ── Chrome ────────────────────────────────────────────────────────────────────

export const emit = (div, item) => {
  div.html(`
    <div class="diagram-editor" style="border:1px solid #ddd;border-radius:4px;overflow:hidden;font-size:12px;">
      <div class="de-subject" style="padding:5px 8px;background:#f6f6f6;border-bottom:1px solid #eee;color:#555;">
        Looking for a diagram…
      </div>
      <div class="de-body"></div>
    </div>
  `)
}

const TEXTAREA_STYLE = `
  display:block;width:100%;min-height:260px;box-sizing:border-box;
  border:0;border-bottom:1px solid #eee;padding:8px;resize:vertical;
  font-family:Menlo,Consolas,monospace;font-size:12px;line-height:1.45;
`

const helpHtml = subject => `
  <details class="de-help" style="padding:6px 8px;background:#fafafa;">
    <summary style="cursor:pointer;color:#666;">${esc(dslOf(subject.item) || 'syntax')} syntax</summary>
    <div style="padding-top:6px;">${cheatHtml(dslOf(subject.item), subject.item)}</div>
  </details>
`

const shellHtml = subject => `
  <textarea class="de-text" spellcheck="false" style="${TEXTAREA_STYLE}"></textarea>
  <div style="padding:6px 8px;border-bottom:1px solid #eee;">
    <button class="de-save" style="margin-right:6px;">Save</button>
    <button class="de-revert">Revert</button>
    <span class="de-status" style="margin-left:8px;color:#888;"></span>
  </div>
  ${helpHtml(subject)}
`

// Not logged in: the wiki hides its own edit affordances, so an editable-looking
// box with a dead Save button is worse than saying so. Show the source read-only.
const lockedHtml = subject => `
  <p style="margin:0;padding:8px;background:#fff6f6;border-bottom:1px solid #eee;color:#a00;">
    Log in as the site owner to edit this ${esc(subject.item ? subject.item.type : 'item')}.
    Nothing typed here could be saved.
  </p>
  <textarea class="de-text" readonly spellcheck="false"
    style="${TEXTAREA_STYLE}background:#fafafa;color:#666;"></textarea>
  ${helpHtml(subject)}
`

const pickerHtml = candidates => `
  <div style="padding:8px;">
    <p style="margin:0 0 6px;color:#666;">
      More than one diagram is in play and nothing says which you meant. Pick one:
    </p>
    ${candidates.map(c => `
      <button class="de-pick" data-pick="${esc(c.pageKey)}/${esc(c.itemId)}" style="
        display:block;width:100%;text-align:left;margin-bottom:4px;padding:5px 7px;cursor:pointer;
      ">${esc(c.item ? c.item.type : 'item')} — ${esc(firstLine(c.item))} <span style="color:#999;">on ${esc(c.pageTitle || c.slug)}</span></button>
    `).join('')}
  </div>
`

const firstLine = item => {
  const t = ((item && item.text) || '').split('\n').map(s => s.trim()).filter(Boolean)
  const line = item && item.type === 'diagram' ? (t[1] || t[0] || '') : (t[0] || '')
  return line.length > 48 ? `${line.slice(0, 48)}…` : (line || 'empty')
}

// ── No subject: the scratch pad ───────────────────────────────────────────────
// Opened from the ☰ menu there is nothing to the left to edit, and a page that
// only says so is a dead end. So the empty state becomes a place to draw: pick a
// dialect, type, watch it render. It deliberately has NO save path — this page
// belongs to the plugin, not to your wiki, and writing here would write into
// everyone's copy. Copy the source out and paste it into a diagram item instead.

const HELP_URL = 'https://plugin.fedwiki.club/view/running-kroki-locally'

// Advertised by Kroki's /health but 503 on the local container — they silently
// need the public broker, so say so before someone picks one offline.
const NEEDS_INTERNET = new Set(['bpmn', 'excalidraw', 'diagramsnet'])

const DIALECTS = [
  'mermaid', 'graphviz', 'd2', 'plantuml', 'svgbob', 'nomnoml', 'pikchr',
  'blockdiag', 'seqdiag', 'actdiag', 'nwdiag', 'ditaa', 'erd', 'bytefield',
  'structurizr', 'wavedrom', 'vega', 'vegalite', 'umlet', 'wireviz',
  'bpmn', 'excalidraw', 'diagramsnet',
]

const SAMPLES = {
  mermaid: 'flowchart LR\n  A[Proposition] --> B{Delegable?}\n  B -->|yes| C[Score]\n  B -->|no| D[Not for this market]',
  graphviz: 'digraph {\n  rankdir=LR\n  node [shape=box, style=rounded]\n  "Artist" -> "Gallery" -> "Collector"\n}',
  d2: 'artist -> gallery: consigns\ngallery -> collector: sells',
  plantuml: '@startuml\nArtist -> Gallery: consign\nGallery -> Collector: sell\n@enduml',
  svgbob: '  +---------+      +----------+\n  |  score  +----->+ instance |\n  +---------+      +----------+',
  nomnoml: '[Score] -> [Realisation]\n[Realisation] -> [Certificate]',
}

const scratchHtml = () => `
  <div style="padding:8px;">
    <p style="margin:0 0 8px;color:#666;">
      Nothing to the left of this page to edit — so this is a scratch pad. Pick a
      dialect and type; it renders as you go. Nothing here is saved: copy the source
      into a <code>diagram</code> item on a page of your own to keep it.
    </p>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
      <select class="de-dialect" style="padding:3px 4px;">
        ${DIALECTS.map(d => `<option value="${d}"${d === 'mermaid' ? ' selected' : ''}>${d}${
          NEEDS_INTERNET.has(d) ? ' — needs internet' : ''}</option>`).join('')}
      </select>
      <button class="de-copy">Copy source</button>
      <span class="de-scratch-status" style="color:#888;"></span>
    </div>
    <textarea class="de-scratch" spellcheck="false"
      style="${TEXTAREA_STYLE}min-height:150px;">${esc(SAMPLES.mermaid)}</textarea>
    <div class="de-preview" style="margin-top:8px;padding:6px;border:1px solid #eee;border-radius:4px;
      background:#fff;min-height:60px;"></div>
    <p class="de-broker" style="margin:6px 0 0;font-size:12px;color:#888;"></p>
  </div>
`

// Which broker answered, said plainly. Local Kroki is optional — the render broker
// falls back to the public service — so this reports first and only offers the
// install when the local one was not there.
const brokerNote = ($el, endpoint) => {
  if (!$el || !$el.length) return
  if (endpoint && /render\.localhost/.test(endpoint)) {
    $el.css('color', '#888').html('Rendered locally by <code>render.localhost</code>.')
  } else if (endpoint) {
    $el.css('color', '#92400e').html(
      `Rendered by the public <code>kroki.io</code> — your diagram source left this ` +
      `machine. A local Kroki keeps it here, works offline and is quicker: ` +
      `<a href="${HELP_URL}" target="_blank" rel="noreferrer">how to run one</a>.`)
  } else {
    $el.css('color', '#b91c1c').html(
      `No render broker answered — the local one is not running and the public one ` +
      `is unreachable. <a href="${HELP_URL}" target="_blank" rel="noreferrer">` +
      `Running Kroki locally</a> fixes the first half.`)
  }
}

const wireScratch = ($body) => {
  const $ = window.$
  const $text = $body.find('.de-scratch')
  const $dialect = $body.find('.de-dialect')
  const $preview = $body.find('.de-preview')
  const $status = $body.find('.de-scratch-status')
  const $broker = $body.find('.de-broker')
  let timer = null
  let seq = 0

  const draw = async () => {
    const mine = ++seq
    const type = $dialect.val()
    const source = $text.val()
    if (!source.trim()) { $preview.empty(); $broker.empty(); return }
    $status.text('drawing…')
    try {
      const { svg, endpoint } = await fetchKroki(type, source)
      if (mine !== seq) return                       // a later keystroke won
      const el = sanitizeSVG(svg)
      $preview.empty()
      if (el) $preview[0].appendChild(el)
      else $preview.text('The broker returned something that is not an SVG.')
      $status.text('')
      brokerNote($broker, endpoint)
    } catch (err) {
      if (mine !== seq) return
      $status.text('')
      $preview.html(`<span style="color:#b91c1c;">⚠ ${esc(err.message)}</span>`)
      brokerNote($broker, null)
    }
  }

  const queue = () => { clearTimeout(timer); timer = setTimeout(draw, REDRAW_MS) }

  $text.on('input', queue)
  $dialect.on('change', () => {
    const sample = SAMPLES[$dialect.val()]
    // Only replace the text when it is still an untouched sample, never real work.
    const current = $text.val().trim()
    const isSample = Object.values(SAMPLES).some(s => s.trim() === current) || !current
    if (isSample) $text.val(sample || '')
    draw()
  })
  $body.find('.de-copy').on('click', async () => {
    const payload = `${$dialect.val()}\n${$text.val()}`   // ready to paste as a diagram item
    try {
      await navigator.clipboard.writeText(payload)
      $status.text('copied — paste into a diagram item')
    } catch (e) {
      $status.text('copy blocked by the browser')
    }
  })
  draw()
}

// ── Tool mode ─────────────────────────────────────────────────────────────────
// A sketch pad. Everything here acts on the nearest diagram to the left, so the
// page is a place to try out what a diagram tool page could usefully offer.

const WIDTH_CHOICES = ['NATURAL', 'FULL', 'HALF', '320']
const ALIGN_CHOICES = ['CENTRE', 'LEFT', 'RIGHT']

const factsOf = subject => {
  const svg = subject.$item.find('svg')[0]
  const vb = svg ? (svg.getAttribute('viewBox') || '').split(/[\s,]+/) : []
  const box = svg && svg.getBoundingClientRect()
  const text = (subject.item && subject.item.text) || ''
  return [
    ['item type', subject.item ? subject.item.type : '—'],
    ['dialect', dslOf(subject.item) || '—'],
    ['on page', subject.pageTitle || subject.slug],
    ['natural size', vb[2] ? `${Math.round(vb[2])} × ${Math.round(vb[3])}` : 'not rendered'],
    ['rendered size', box ? `${Math.round(box.width)} × ${Math.round(box.height)}` : '—'],
    ['WIDTH', readDirective(text, 'WIDTH') || 'NATURAL (default)'],
    ['ALIGN', readDirective(text, 'ALIGN') || 'CENTRE (default)'],
    ['source lines', String(text.split('\n').length)],
  ]
}

const labelsOf = subject =>
  [...new Set(subject.$item.find('svg text').map((_i, el) => (el.textContent || '').trim()).get()
    .filter(t => t && t.length < 60))]

let pageIndexPromise = null
const wikiPages = () => {
  if (!pageIndexPromise) {
    pageIndexPromise = fetch('/system/sitemap.json')
      .then(r => r.json())
      .then(list => new Set((list || []).map(p => String(p.title || '').toLowerCase())))
      .catch(() => new Set())
  }
  return pageIndexPromise
}

const toolShellHtml = subject => `
  <div style="padding:8px;">
    <table style="border-collapse:collapse;font-size:11px;width:100%;margin-bottom:10px;">
      ${factsOf(subject).map(([k, v]) => `
        <tr>
          <td style="padding:2px 8px 2px 0;color:#888;white-space:nowrap;">${esc(k)}</td>
          <td style="padding:2px 0;font-family:monospace;color:#333;">${esc(v)}</td>
        </tr>`).join('')}
    </table>

    <p style="margin:0 0 4px;color:#666;font-size:11px;">Width — applies straight away, redrawing on the left:</p>
    <div style="margin-bottom:10px;">
      ${WIDTH_CHOICES.map(w => `<button class="dt-width" data-w="${w}" style="margin:0 4px 4px 0;">${w}</button>`).join('')}
      <button class="dt-save" style="margin-left:6px;">Save</button>
      <span class="dt-status" style="margin-left:6px;color:#888;font-size:11px;"></span>
    </div>

    <p style="margin:0 0 4px;color:#666;font-size:11px;">Alignment:</p>
    <div style="margin-bottom:10px;">
      ${ALIGN_CHOICES.map(a => `<button class="dt-align" data-a="${a}" style="margin:0 4px 4px 0;">${a}</button>`).join('')}
    </div>

    <p style="margin:0 0 4px;color:#666;font-size:11px;">Labels in the diagram, and whether a wiki page answers to them:</p>
    <div class="dt-labels" style="font-size:11px;margin-bottom:10px;color:#999;">reading…</div>

    <details>
      <summary style="cursor:pointer;color:#666;font-size:11px;">source</summary>
      <pre class="dt-source" style="margin:6px 0 0;padding:6px;background:#fafafa;overflow-x:auto;
        font-family:Menlo,Consolas,monospace;font-size:11px;line-height:1.4;"></pre>
    </details>
  </div>
`

const showTool = ($body, div, item, subject) => {
  $body.html(toolShellHtml(subject))
  let current = (subject.item && subject.item.text) || ''
  const $status = $body.find('.dt-status')
  $body.find('.dt-source').text(current)

  const applyDirective = async (key, value) => {
    current = setDirective(current, key, value)
    await rerenderItem(subject.$item, { ...subject.item, text: current }, subject.$page)
    $body.find('.dt-source').text(current)
    $status.css('color', '#888').text(`${key} ${value} — not saved`)
  }

  $body.find('.dt-width').on('click', ev => applyDirective('WIDTH', window.$(ev.currentTarget).attr('data-w')))
  $body.find('.dt-align').on('click', ev => applyDirective('ALIGN', window.$(ev.currentTarget).attr('data-a')))

  $body.find('.dt-save').on('click', async () => {
    $status.css('color', '#888').text('Saving…')
    try {
      const res = await saveSubject(subject, { ...subject.item, text: current })
      $status.css('color', res.ok ? '#282' : '#c00')
        .text(res.ok ? 'Saved.' : res.blockers.join(' '))
    } catch (e) {
      $status.css('color', '#c00').text(`Save failed: ${e.message}`)
    }
  })

  const labels = labelsOf(subject)
  wikiPages().then(pages => {
    const $l = $body.find('.dt-labels')
    if (!labels.length) { $l.css('color', '#999').text('No text found — the diagram may not have rendered.'); return }
    $l.html(labels.map(t => {
      const known = pages.has(t.toLowerCase())
      return `<span style="display:inline-block;margin:0 6px 4px 0;padding:1px 5px;border-radius:3px;
        background:${known ? '#eef6ee' : '#fdf0f0'};color:${known ? '#282' : '#a00'};">${esc(t)}</span>`
    }).join('') + `<div style="margin-top:4px;color:#999;">green resolves to a page, red would be a new one</div>`)
  })
}

// ── Bind ──────────────────────────────────────────────────────────────────────

export const bind = (div, item) => {
  const $ = window.$
  const $body = div.find('.de-body')
  const $subject = div.find('.de-subject')

  const mode = parseMode(item.text)

  const show = () => {
    const { subject, candidates, how } = resolveSubject(div, item)

    // The tool is a read-mostly inspector, so it never stops to ask: it takes the
    // nearest diagram to its left and says which one that was.
    if (mode === 'tool') {
      const subj = subject || (candidates.length ? candidates[candidates.length - 1] : null)
      if (!subj) { $subject.text('Scratch pad'); $body.html(scratchHtml()); wireScratch($body); return }
      $subject.text(subjectNote(subj).replace(/^Editing/, 'Inspecting'))
      showTool($body, div, item, subj)
      return
    }

    if (!subject) {
      $subject.text(how === 'ambiguous' ? 'Which diagram?' : 'Scratch pad')
      if (how === 'ambiguous') {
        $body.html(pickerHtml(candidates))
        $body.find('.de-pick').on('click', ev => {
          chooseSubject(div, item, $(ev.currentTarget).attr('data-pick'))
          show()
        })
      } else {
        $body.html(scratchHtml())
        wireScratch($body)
      }
      return
    }

    $subject.text(subjectNote(subject))

    const original = (subject.item && subject.item.text) || ''

    if (!editState().authed) {
      $body.html(lockedHtml(subject))
      $body.find('.de-text').val(original)
      return
    }

    $body.html(shellHtml(subject))
    const $text = $body.find('.de-text')
    const $status = $body.find('.de-status')
    const $save = $body.find('.de-save')
    $text.val(original)

    const blockers = saveBlockers(subject)
    const warnings = saveWarnings(subject)
    if (blockers.length) {
      $status.css('color', '#c00').text(blockers.join(' '))
    } else if (warnings.length) {
      $status.css('color', '#a60').text(warnings.join(' '))
    }

    // Save is live only while there is something unsaved to save. Starts dim,
    // dims again the moment a save lands, and wakes on the next keystroke.
    let lastSaved = original
    const refreshSave = () =>
      $save.prop('disabled', blockers.length > 0 || $text.val() === lastSaved)
    refreshSave()

    // Live redraw: update the source item in the DOM only. A put on every
    // keystroke would fill the page journal with noise.
    let timer = null
    const redraw = () => {
      clearTimeout(timer)
      timer = setTimeout(async () => {
        const next = { ...subject.item, text: $text.val() }
        try {
          await rerenderItem(subject.$item, next, subject.$page)
        } catch (e) {
          $status.css('color', '#c00').text(`Render failed: ${e.message}`)
        }
      }, REDRAW_MS)
    }
    $text.on('input', () => { refreshSave(); redraw() })

    $save.on('click', async () => {
      const text = $text.val()                 // pin it: they may keep typing mid-save
      const next = { ...subject.item, text }
      $status.css('color', '#888').text('Saving…')
      $save.prop('disabled', true)
      try {
        const res = await saveSubject(subject, next)
        if (!res.ok) {
          $status.css('color', '#c00').text(res.blockers.join(' '))
          refreshSave()                        // still dirty, so they can retry
          return
        }
        lastSaved = text
        refreshSave()
        $status.css('color', res.warnings.length ? '#a60' : '#282')
          .text(res.warnings.length ? `Saved. ${res.warnings.join(' ')}` : 'Saved.')
      } catch (e) {
        // Without this the status would sit on "Saving…" for ever and the failure
        // would only appear in the console.
        $status.css('color', '#c00').text(`Save failed: ${e.message}`)
        refreshSave()
      }
    })

    $body.find('.de-revert').on('click', () => {
      $text.val(original)
      refreshSave()
      redraw()
      $status.css('color', '#888').text('Reverted — not yet saved.')
    })
  }

  show()
}

if (typeof window !== 'undefined') {
  installClickRecorder()
  window.plugins = window.plugins || {}
  // `consumes` is read off the plugin object by wiki-client/lib/plugin.js, not from
  // factory.json — no server change is needed for it.
  window.plugins['diagram-editor'] = {
    emit,
    bind,
    // One combined selector, not one per type: plugin.js logs "no items in lineup
    // that produces X" for every selector that matches nothing, and a page rarely
    // holds all four kinds. jQuery .filter() takes the comma form.
    consumes: [EDITABLE.map(t => `.${t}`).join(', ')],
  }
}
