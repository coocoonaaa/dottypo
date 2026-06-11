import './style.css'
import { supabase } from './supabase.js'

// ─────────────────────────────────────────────
//  AUTH STATE
// ─────────────────────────────────────────────
let currentUser = null
let currentProfile = null
let currentCloudDocId = null
let autoSaveTimer = null

// ─────────────────────────────────────────────
//  THEMES
// ─────────────────────────────────────────────
const THEMES = {
  light: {
    canvasBg:        'transparent',
    thumbnailBg:     '#ffffff',
    placeholderText: 'rgba(0,0,0,0.25)',
    hoverFill:       'rgba(61,110,0,0.08)',
    hoverStroke:     'rgba(61,110,0,0.32)',
    gridLine:        'rgba(0,0,0,0.13)',
  },
  dark: {
    canvasBg:        '#0f0f0d',
    thumbnailBg:     '#222220',
    placeholderText: 'rgba(255,255,255,0.22)',
    hoverFill:       'rgba(212,240,74,0.18)',
    hoverStroke:     'rgba(212,240,74,0.4)',
    gridLine:        'rgba(255,255,255,0.22)',
  }
}
let currentTheme = 'light'

const SVG_MOON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
const SVG_SUN  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="7.05" y2="7.05"/><line x1="16.95" y1="16.95" x2="19.07" y2="19.07"/><line x1="4.93" y1="19.07" x2="7.05" y2="16.95"/><line x1="16.95" y1="7.05" x2="19.07" y2="4.93"/></svg>`

// ─────────────────────────────────────────────
//  CHARSETS
// ─────────────────────────────────────────────
const CHARSET_LATIN  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?@&-_:;"\'()[]{}#$%/\\+*=<>~|^`'.split('')
const CHARSET_KOREAN = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㄲㄸㅃㅆㅉㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣㅐㅒㅔㅖㅘㅙㅚㅝㅞㅟㅢ'.split('')
const CHARSET = [...CHARSET_LATIN, ...CHARSET_KOREAN]

// ─────────────────────────────────────────────
//  MODE & SHARED NAV
// ─────────────────────────────────────────────
let currentMode = 'pixel'
let currentCharIdx = 0
let currentDocType = 'font'  // 'font' | 'lettering'
const LETTERING_KEY = '__lettering__'

// ── Guide lines ──
let guideState = {
  enabled: false,
  hLines: [50],
  vLines: [50]
}
let gridDocName = 'Untitled'
let pixelDocName = 'Untitled'

function getCurrentDocName() {
  return currentMode === 'grid' ? gridDocName : pixelDocName
}
function setCurrentDocName(val) {
  if (currentMode === 'grid') gridDocName = val; else pixelDocName = val
}

// ─────────────────────────────────────────────
//  GRID STATE
// ─────────────────────────────────────────────
function makeGlyphStore() {
  const g = {}
  CHARSET.forEach(c => { g[c] = null })
  return g
}

const GRID_TYPES = ['rectangular', 'polar', 'triangular', 'organic']

const state = {
  rows: 8, cols: 8, gutterX: 0, gutterY: 0,
  ratio: 100,
  gridType: 'rectangular', cellColor: '#000000',
  showGrid: true, gridOpacity: 1, zoom: 1.0,
  glyphsByType: {
    rectangular: makeGlyphStore(),
    polar:       makeGlyphStore(),
    triangular:  makeGlyphStore(),
    organic:     makeGlyphStore()
  },
  polar: { innerRadius: 20, angle: 0 },
  triangular: { diagonal: 'Left' },
  organic: { subType: 'Wave' }
}

function gridGlyphs() { return state.glyphsByType[state.gridType] }

function ensureGlyphStores() {
  GRID_TYPES.forEach(t => {
    if (!state.glyphsByType[t]) state.glyphsByType[t] = makeGlyphStore()
    CHARSET.forEach(c => { if (!(c in state.glyphsByType[t])) state.glyphsByType[t][c] = null })
  })
}

// ─────────────────────────────────────────────
//  PIXEL STATE
// ─────────────────────────────────────────────
function makePixelLayer(name = 'Layer 1', shape = 'rect', color = '#000000', params = {}) {
  const layer = {
    id: Date.now() + Math.random(), name, shape, color, opacity: 1.0, visible: true,
    rows: params.rows ?? 24, cols: params.cols ?? 16,
    cellW: params.cellW ?? 15, cellH: params.cellH ?? 15,
    gapX: params.gapX ?? 1, gapY: params.gapY ?? 1,
    smooth: params.smooth ?? 0, skew: params.skew ?? 0,
    rowStagger: params.rowStagger ?? 0, colStagger: params.colStagger ?? 0,
    offsetX: params.offsetX ?? 0, offsetY: params.offsetY ?? 0,
    glyphs: {}
  }
  CHARSET.forEach(c => { layer.glyphs[c] = null })
  return layer
}

const pixelState = {
  showGrid: true, gridOpacity: 1, zoom: 1.0,
  layers: null, activeLayerIdx: 0
}
pixelState.layers = [makePixelLayer()]

// ─────────────────────────────────────────────
//  CANVAS
// ─────────────────────────────────────────────
const canvas = document.getElementById('grid-canvas')
const ctx = canvas.getContext('2d')
const CELL_SIZE  = 33   // grid mode fixed cell height (70% of 47)
const CANVAS_PAD = 24   // grid mode padding
const PIXEL_PAD  = 16   // pixel mode padding
let isDragging = false, dragMode = null

// ─────────────────────────────────────────────
//  UNDO
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  UNDO / REDO
// ─────────────────────────────────────────────
const undoStack = []
const redoStack = []
const MAX_HISTORY = 50
let _historyPending = false

document.addEventListener('mouseup', () => { _historyPending = false })

function captureState() {
  return currentMode === 'grid'
    ? { mode: 'grid', charIdx: currentCharIdx, data: JSON.parse(JSON.stringify(state)) }
    : { mode: 'pixel', charIdx: currentCharIdx, data: JSON.parse(JSON.stringify(pixelState)) }
}

function pushHistory() {
  if (_historyPending) return
  _historyPending = true
  undoStack.push(captureState())
  if (undoStack.length > MAX_HISTORY) undoStack.shift()
  redoStack.length = 0
  updateUndoRedoBtns()
}

function applySnapshot(snap) {
  if (snap.mode !== currentMode) switchMode(snap.mode)
  currentCharIdx = snap.charIdx
  if (snap.mode === 'grid') {
    Object.assign(state, snap.data)
    gridSyncSliders(); setGridType(state.gridType)
  } else {
    Object.assign(pixelState, snap.data)
    pixelSyncSliders()
  }
  updateActiveCharCell()
  resizeCanvas(); renderMainCanvas(hoveredCell); renderAllThumbnails(); renderPreview()
}

function undo() {
  if (!undoStack.length) return
  redoStack.push(captureState())
  applySnapshot(undoStack.pop())
  setStatus('Undo')
  updateUndoRedoBtns()
}

function redo() {
  if (!redoStack.length) return
  undoStack.push(captureState())
  applySnapshot(redoStack.pop())
  setStatus('Redo')
  updateUndoRedoBtns()
}

function updateUndoRedoBtns() {
  const u = document.getElementById('btn-undo')
  const r = document.getElementById('btn-redo')
  if (u) u.style.opacity = undoStack.length ? '1' : '0.35'
  if (r) r.style.opacity = redoStack.length ? '1' : '0.35'
}

// ─────────────────────────────────────────────
//  GRID LAYOUT
// ─────────────────────────────────────────────
let gridPaths = []

function getGridActualCols() {
  if (state.gridType === 'triangular') {
    const d = state.triangular.diagonal
    if (d === 'Both') return state.cols * 4
    if (d === 'isoH') return state.cols * 2 + 1  // up+down triangles per row
    if (d === 'isoV') return state.cols * 2 + 1  // left+right triangles per col
    return state.cols * 2
  }
  return state.cols
}

// All grid types use the same logical bounding box: cols*CELL_SIZE x rows*CELL_SIZE
// Everything is drawn inside this box, then centered on the canvas.
const GRID_LOGICAL_W = () => state.cols * CELL_SIZE * (state.ratio / 100)
const GRID_LOGICAL_H = () => state.rows * CELL_SIZE

function gridGetCanvasSize() {
  const lw = GRID_LOGICAL_W(), lh = GRID_LOGICAL_H()
  return { w: lw + CANVAS_PAD * 2, h: lh + CANVAS_PAD * 2 }
}

// Compute the translate offset to center the logical grid on the canvas
function gridGetOffset() {
  return { ox: CANVAS_PAD, oy: CANVAS_PAD }
}

function gridBuildPaths() {
  gridPaths = []
  const { rows, cols, gutterX, gutterY, ratio, gridType, polar, triangular, organic } = state
  const cw = CELL_SIZE * ratio / 100
  const lw = GRID_LOGICAL_W(), lh = GRID_LOGICAL_H()
  const actualCols = getGridActualCols()

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < actualCols; c++) {
      const p = new Path2D()

      if (gridType === 'polar') {
        // Fit the polar grid inside the logical bounding box
        const cx = lw / 2, cy = lh / 2
        const maxR = Math.min(lw, lh) / 2
        const innerFrac = polar.innerRadius / 100  // 0..0.8
        const innerR = maxR * innerFrac
        const usableR = maxR - innerR
        const dr = usableR / rows
        const rIn  = innerR + r * dr
        const rOut = innerR + (r + 1) * dr
        const da = (Math.PI * 2) / cols
        const angleOffset = (polar.angle || 0) * Math.PI / 180
        const startA = c * da - Math.PI / 2 + angleOffset
        const endA   = (c + 1) * da - Math.PI / 2 + angleOffset
        p.arc(cx, cy, rOut, startA, endA)
        p.arc(cx, cy, rIn,  endA, startA, true)
        p.closePath()
      }
      else if (gridType === 'triangular') {
        const { diagonal } = triangular

        if (diagonal === 'isoH') {
          // Horizontal isometric: staggered rows, triH=CELL_SIZE to fill bounding box vertically
          const triW = cw
          const triH = CELL_SIZE
          const halfW = triW / 2
          const triIdx = c
          const rowOffset = (r % 2 === 0) ? 0 : halfW
          const xLeft = triIdx * halfW + rowOffset - halfW
          const yTop  = r * triH
          const yBot  = yTop + triH
          const xMid  = xLeft + halfW
          const xRight= xLeft + triW
          if (triIdx % 2 === 0) {
            p.moveTo(xLeft, yBot); p.lineTo(xRight, yBot); p.lineTo(xMid, yTop)
          } else {
            p.moveTo(xLeft, yTop); p.lineTo(xRight, yTop); p.lineTo(xMid, yBot)
          }
          p.closePath()
        }
        else if (diagonal === 'isoV') {
          // Vertical isometric: staggered columns, triW=cw to fill bounding box horizontally
          const triW = cw
          const triH = CELL_SIZE
          const halfH = triH / 2
          const rectC = Math.floor(c / 2)
          const colStagger = (c % 2 === 0) ? 0 : halfH
          const xLeft  = rectC * triW
          const xRight = xLeft + triW
          const yTop   = r * CELL_SIZE + colStagger - halfH
          const yMid   = yTop + halfH
          const yBot   = yTop + triH
          if ((r + c) % 2 === 0) {
            p.moveTo(xLeft, yTop); p.lineTo(xLeft, yBot); p.lineTo(xRight, yMid)
          } else {
            p.moveTo(xRight, yTop); p.lineTo(xRight, yBot); p.lineTo(xLeft, yMid)
          }
          p.closePath()
        }
        else if (diagonal === 'Both') {
          const rectC = Math.floor(c / 4), subIdx = c % 4
          const bx = rectC * cw, by = r * CELL_SIZE
          const mx = bx + cw / 2, my = by + CELL_SIZE / 2
          if (subIdx === 0) { p.moveTo(bx,by); p.lineTo(bx+cw,by); p.lineTo(mx,my) }
          if (subIdx === 1) { p.moveTo(bx+cw,by); p.lineTo(bx+cw,by+CELL_SIZE); p.lineTo(mx,my) }
          if (subIdx === 2) { p.moveTo(bx+cw,by+CELL_SIZE); p.lineTo(bx,by+CELL_SIZE); p.lineTo(mx,my) }
          if (subIdx === 3) { p.moveTo(bx,by+CELL_SIZE); p.lineTo(bx,by); p.lineTo(mx,my) }
          p.closePath()
        } else {
          const rectC = Math.floor(c / 2), subIdx = c % 2
          const bx = rectC * cw, by = r * CELL_SIZE
          if (diagonal === 'Left') {
            if (subIdx === 0) { p.moveTo(bx,by); p.lineTo(bx+cw,by); p.lineTo(bx,by+CELL_SIZE) }
            if (subIdx === 1) { p.moveTo(bx+cw,by); p.lineTo(bx+cw,by+CELL_SIZE); p.lineTo(bx,by+CELL_SIZE) }
          } else if (diagonal === 'Right') {
            if (subIdx === 0) { p.moveTo(bx,by); p.lineTo(bx+cw,by); p.lineTo(bx+cw,by+CELL_SIZE) }
            if (subIdx === 1) { p.moveTo(bx,by); p.lineTo(bx+cw,by+CELL_SIZE); p.lineTo(bx,by+CELL_SIZE) }
          }
          p.closePath()
        }
      }
      else if (gridType === 'organic') {
        const { subType } = organic
        const bx = c * cw, by = r * CELL_SIZE
        if (subType === 'Arc') {
          // Corner-anchored arcs fitting inside the logical box
          const maxR = Math.max(lw, lh)
          const dr = maxR / rows
          const rIn  = r * dr, rOut = (r + 1) * dr
          const da = (Math.PI / 2) / cols
          const startA = c * da, endA = (c + 1) * da
          p.arc(0, lh, rOut, -Math.PI/2 + startA, -Math.PI/2 + endA)
          p.arc(0, lh, rIn,  -Math.PI/2 + endA, -Math.PI/2 + startA, true)
          p.closePath()
        } else if (subType === 'Wave') {
          const wave = (px, py) => ({ dx: Math.sin(py * 0.08) * cw * 0.25, dy: Math.cos(px * 0.08) * CELL_SIZE * 0.25 })
          const v1 = wave(bx,by), v2 = wave(bx+cw,by), v3 = wave(bx+cw,by+CELL_SIZE), v4 = wave(bx,by+CELL_SIZE)
          p.moveTo(bx+v1.dx, by+v1.dy); p.lineTo(bx+cw+v2.dx, by+v2.dy)
          p.lineTo(bx+cw+v3.dx, by+CELL_SIZE+v3.dy); p.lineTo(bx+v4.dx, by+CELL_SIZE+v4.dy)
          p.closePath()
        } else if (subType === 'Radial') {
          const gcx = lw / 2, gcy = lh / 2
          const distort = (px, py) => {
            const dx = px - gcx, dy = py - gcy
            const dist = Math.sqrt(dx*dx + dy*dy)
            const factor = 1 + dist / (Math.max(lw, lh)) * 0.5
            return { x: gcx + dx * factor, y: gcy + dy * factor }
          }
          const p1 = distort(bx,by), p2 = distort(bx+cw,by)
          const p3 = distort(bx+cw,by+CELL_SIZE), p4 = distort(bx,by+CELL_SIZE)
          p.moveTo(p1.x,p1.y); p.lineTo(p2.x,p2.y); p.lineTo(p3.x,p3.y); p.lineTo(p4.x,p4.y)
          p.closePath()
        }
      }
      else {
        // Rectangular: simple grid with optional gutter
        const bx = c * (cw + gutterX)
        const by = r * (CELL_SIZE + gutterY)
        p.rect(bx, by, cw, CELL_SIZE)
      }
      gridPaths.push({ r, c, path: p })
    }
  }
}

function gridResizeCanvas() {
  const { w, h } = gridGetCanvasSize()
  const dpr = window.devicePixelRatio || 1
  canvas.width  = w * dpr; canvas.height = h * dpr
  canvas.style.width  = w + 'px'; canvas.style.height = h + 'px'
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  gridBuildPaths()
}

function gridGetCellFromPoint(px, py) {
  const { ox, oy } = gridGetOffset()
  const dpr = window.devicePixelRatio || 1
  // isPointInPath applies inverse(CTM) to (x,y) before testing.
  // CTM = scale(dpr), so we must pass physical pixels (px*dpr) to hit
  // paths whose coordinates are in CSS pixel space.
  const lx = (px - ox) * dpr
  const ly = (py - oy) * dpr
  for (const { r, c, path } of gridPaths) {
    if (ctx.isPointInPath(path, lx, ly)) return { r, c }
  }
  return null
}

// ─────────────────────────────────────────────
//  PIXEL LAYOUT
// ─────────────────────────────────────────────
function pixelCellW() { return pixelActiveLayer()?.cellW ?? 15 }
function pixelCellH() { return pixelActiveLayer()?.cellH ?? 15 }

function pixelGetCanvasSize() {
  const al = pixelActiveLayer()
  if (!al) return { w: 200, h: 300 }
  const { rows, cols, gapX=1, gapY=1, rowStagger=0, colStagger=0, cellW=15, cellH=15 } = al
  return {
    w: cols * cellW + Math.max(0, cols - 1) * gapX + Math.abs(rowStagger) * (rows - 1) + PIXEL_PAD * 2,
    h: rows * cellH + Math.max(0, rows - 1) * gapY + Math.abs(colStagger) * (cols - 1) + PIXEL_PAD * 2
  }
}

function pixelResizeCanvas() {
  const { w, h } = pixelGetCanvasSize()
  const dpr = window.devicePixelRatio || 1
  canvas.width  = w * dpr; canvas.height = h * dpr
  canvas.style.width  = w + 'px'; canvas.style.height = h + 'px'
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function layerGetCellPos(layer, col, row) {
  const { gapX=1, gapY=1, rowStagger=0, colStagger=0, rows, cols, cellW=15, cellH=15, offsetX=0, offsetY=0 } = layer
  const compX = rowStagger < 0 ? Math.abs(rowStagger) * (rows - 1) : 0
  const compY = colStagger < 0 ? Math.abs(colStagger) * (cols - 1) : 0
  return {
    x: PIXEL_PAD + col * (cellW + gapX) + row * rowStagger + compX + offsetX,
    y: PIXEL_PAD + row * (cellH + gapY) + col * colStagger + compY + offsetY
  }
}

function pixelGetCellPos(col, row) {
  return layerGetCellPos(pixelActiveLayer(), col, row)
}

function pixelGetCellFromPoint(px, py) {
  const al = pixelActiveLayer()
  const { rows, cols, cellW=15, cellH=15 } = al
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const { x, y } = layerGetCellPos(al, c, r)
      if (px >= x && px <= x + cellW && py >= y && py <= y + cellH) return { r, c }
    }
  return null
}

// ─────────────────────────────────────────────
//  DISPATCH: LAYOUT
// ─────────────────────────────────────────────
function resizeCanvas() {
  currentMode === 'grid' ? gridResizeCanvas() : pixelResizeCanvas()
}

function getActiveCellFromPoint(px, py) {
  return currentMode === 'grid' ? gridGetCellFromPoint(px, py) : pixelGetCellFromPoint(px, py)
}

// ─────────────────────────────────────────────
//  SHAPE PATH (shared)
// ─────────────────────────────────────────────
function shapePath(ctx2, w, h, r2, type2) {
  ctx2.beginPath()
  switch (type2) {
    case 'rect': {
      ctx2.roundRect(0, 0, w, h, r2 * Math.min(w, h) * 0.5)
      break
    }
    case 'circle': {
      ctx2.ellipse(w/2, h/2, w/2, h/2, 0, 0, Math.PI * 2)
      break
    }
    case 'diamond': {
      const hw = w/2, hh = h/2, k = r2 * 0.45
      ctx2.moveTo(hw*(1+k), hh*k)
      ctx2.lineTo(hw*(2-k), hh*(1-k))
      ctx2.quadraticCurveTo(w, hh, hw*(2-k), hh*(1+k))
      ctx2.lineTo(hw*(1+k), hh*(2-k))
      ctx2.quadraticCurveTo(hw, h, hw*(1-k), hh*(2-k))
      ctx2.lineTo(hw*k, hh*(1+k))
      ctx2.quadraticCurveTo(0, hh, hw*k, hh*(1-k))
      ctx2.lineTo(hw*(1-k), hh*k)
      ctx2.quadraticCurveTo(hw, 0, hw*(1+k), hh*k)
      ctx2.closePath()
      break
    }
    case 'cross': {
      // Trace cross as a single 12-point polygon so stroke (grid lines) works correctly
      const ox = w * 0.35 * (1 - r2 * 0.3), oy = h * 0.35 * (1 - r2 * 0.3)
      ctx2.moveTo(ox, 0);    ctx2.lineTo(w-ox, 0)
      ctx2.lineTo(w-ox, oy); ctx2.lineTo(w, oy)
      ctx2.lineTo(w, h-oy);  ctx2.lineTo(w-ox, h-oy)
      ctx2.lineTo(w-ox, h);  ctx2.lineTo(ox, h)
      ctx2.lineTo(ox, h-oy); ctx2.lineTo(0, h-oy)
      ctx2.lineTo(0, oy);    ctx2.lineTo(ox, oy)
      ctx2.closePath()
      break
    }
    case 'star4': {
      const cx2 = w/2, cy2 = h/2, ix = w*(0.08+r2*0.40), iy = h*(0.08+r2*0.40)
      for (let i = 0; i < 8; i++) {
        const a = i*Math.PI/4 - Math.PI/2, outer = i%2===0
        const px2 = cx2 + Math.cos(a)*(outer?w/2:ix)
        const py2 = cy2 + Math.sin(a)*(outer?h/2:iy)
        i===0 ? ctx2.moveTo(px2,py2) : ctx2.lineTo(px2,py2)
      }
      ctx2.closePath(); break
    }
    case 'star8': {
      const cx2 = w/2, cy2 = h/2, ix = w*(0.2+r2*0.2), iy = h*(0.2+r2*0.2)
      for (let i = 0; i < 16; i++) {
        const a = i*Math.PI/8 - Math.PI/2, outer = i%2===0
        const px2 = cx2 + Math.cos(a)*(outer?w/2:ix)
        const py2 = cy2 + Math.sin(a)*(outer?h/2:iy)
        i===0 ? ctx2.moveTo(px2,py2) : ctx2.lineTo(px2,py2)
      }
      ctx2.closePath(); break
    }
    case 'ring': {
      const hs = 0.65 - r2*0.45
      ctx2.ellipse(w/2, h/2, w/2, h/2, 0, 0, Math.PI*2, false)
      ctx2.ellipse(w/2, h/2, w/2*hs, h/2*hs, 0, 0, Math.PI*2, true)
      break
    }
    case 'heart': {
      const hx = w/2, top = h*0.28
      ctx2.moveTo(hx, top)
      ctx2.bezierCurveTo(hx, h*0.06,  w,    h*0.06,  w,    h*0.36)
      ctx2.bezierCurveTo(w,    h*0.64, hx,   h*0.82,  hx,   h)
      ctx2.bezierCurveTo(hx,   h*0.82, 0,    h*0.64,  0,    h*0.36)
      ctx2.bezierCurveTo(0,    h*0.06, hx,   h*0.06,  hx,   top)
      ctx2.closePath()
      break
    }
  }
}

// ─────────────────────────────────────────────
//  GRID RENDERING
// ─────────────────────────────────────────────
function renderGuides() {
  if (!guideState.enabled) return
  const { w, h } = currentMode === 'grid' ? gridGetCanvasSize() : pixelGetCanvasSize()
  ctx.save()
  ctx.strokeStyle = 'rgba(80, 160, 255, 0.85)'
  ctx.lineWidth = 1
  ctx.setLineDash([])
  guideState.hLines.forEach(p => {
    const y = Math.round(p / 100 * h) + 0.5
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
  })
  guideState.vLines.forEach(p => {
    const x = Math.round(p / 100 * w) + 0.5
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
  })
  ctx.restore()
}

function gridRenderMainCanvas(hoveredCell) {
  const { cellColor, showGrid } = state
  const { w, h } = gridGetCanvasSize()
  const { ox, oy } = gridGetOffset()

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = THEMES[currentTheme].canvasBg
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.translate(ox, oy)

  const glyph = gridGetCurrentGlyph()
  for (const { r, c, path } of gridPaths) {
    const active  = glyph?.[r]?.[c]
    const hovered = hoveredCell?.r === r && hoveredCell?.c === c
    
    if (active) {
      ctx.fillStyle = cellColor; ctx.fill(path)
    } else if (hovered) {
      ctx.fillStyle = THEMES[currentTheme].hoverFill; ctx.fill(path)
      if (showGrid) { ctx.globalAlpha = state.gridOpacity ?? 1; ctx.strokeStyle = THEMES[currentTheme].hoverStroke; ctx.lineWidth = 1; ctx.stroke(path); ctx.globalAlpha = 1 }
    } else if (showGrid) {
      ctx.globalAlpha = state.gridOpacity ?? 1; ctx.strokeStyle = THEMES[currentTheme].gridLine; ctx.lineWidth = 1; ctx.stroke(path); ctx.globalAlpha = 1
    }
  }
  ctx.restore()
  renderGuides()
}

// ─────────────────────────────────────────────
//  PIXEL RENDERING
// ─────────────────────────────────────────────
function pixelRenderMainCanvas(hoveredCell) {
  const { w, h } = pixelGetCanvasSize()
  const al = pixelActiveLayer()
  const { rows, cols, smooth=0, skew=0, cellW=15, cellH=15 } = al
  const r2 = smooth / 100
  const skewFactor = skew / 100
  const char = getCurrentCharKey()
  const { showGrid } = pixelState

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = THEMES[currentTheme].canvasBg
  ctx.fillRect(0, 0, w, h)

  // Pass 1: grid lines using active layer params
  if (showGrid) {
    ctx.globalAlpha = pixelState.gridOpacity ?? 1
    ctx.strokeStyle = THEMES[currentTheme].gridLine
    ctx.lineWidth = 1
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const { x, y } = layerGetCellPos(al, c, r)
        ctx.save(); ctx.translate(x, y)
        if (skewFactor !== 0) ctx.transform(1, 0, skewFactor, 1, 0, 0)
        shapePath(ctx, cellW, cellH, r2, al.shape)
        ctx.stroke()
        ctx.restore()
      }
    }
    ctx.globalAlpha = 1
  }

  // Pass 2: render each layer with its own params (reverse so index-0 = top of list = top of canvas)
  ;[...pixelState.layers].reverse().forEach(layer => {
    if (layer.visible === false) return
    const glyph = layer.glyphs[char]; if (!glyph) return
    const { rows: lr, cols: lc, smooth: ls=0, skew: lsk=0, cellW: lw=15, cellH: lh=15 } = layer
    const lr2 = ls / 100, lSkew = lsk / 100
    ctx.globalAlpha = layer.opacity
    ctx.fillStyle = layer.color
    for (let r = 0; r < lr; r++) {
      for (let c = 0; c < lc; c++) {
        if (!glyph[r]?.[c]) continue
        const { x, y } = layerGetCellPos(layer, c, r)
        ctx.save(); ctx.translate(x, y)
        if (lSkew !== 0) ctx.transform(1, 0, lSkew, 1, 0, 0)
        shapePath(ctx, lw, lh, lr2, layer.shape)
        ctx.fill()
        ctx.restore()
      }
    }
    ctx.globalAlpha = 1
  })

  // Pass 3: hover on active layer
  if (hoveredCell) {
    const { r, c } = hoveredCell
    const activeGlyph = al.glyphs[char]
    if (!activeGlyph?.[r]?.[c]) {
      const { x, y } = layerGetCellPos(al, c, r)
      ctx.save(); ctx.translate(x, y)
      if (skewFactor !== 0) ctx.transform(1, 0, skewFactor, 1, 0, 0)
      ctx.fillStyle = THEMES[currentTheme].hoverFill
      shapePath(ctx, cellW, cellH, r2, al.shape)
      ctx.fill()
      if (showGrid) {
        ctx.globalAlpha = pixelState.gridOpacity ?? 1
        ctx.strokeStyle = THEMES[currentTheme].hoverStroke
        ctx.lineWidth = 1; ctx.stroke()
        ctx.globalAlpha = 1
      }
      ctx.restore()
    }
  }
  renderGuides()
}


// ─────────────────────────────────────────────
//  EXPORT HELPERS (canvas-based render + vector trace)
// ─────────────────────────────────────────────

// Render a character's pixel layers to a standalone canvas at `scale` × res.
// Returns {canvas, cssW, cssH, pW, pH, minX, minY} or null if char is empty.
function pixelRenderCharToCanvas(char, scale) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const layer of pixelState.layers) {
    if (layer.visible === false) continue
    const g = layer.glyphs[char]; if (!g) continue
    const { rows: lr, cols: lc, cellW: lw = 15, cellH: lh = 15 } = layer
    for (let r = 0; r < lr; r++) for (let c = 0; c < lc; c++) {
      if (!g[r]?.[c]) continue
      const { x, y } = layerGetCellPos(layer, c, r)
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + lw); maxY = Math.max(maxY, y + lh)
    }
  }
  if (!isFinite(minX)) return null

  const cssW = maxX - minX, cssH = maxY - minY
  const pW = Math.max(1, Math.ceil(cssW * scale))
  const pH = Math.max(1, Math.ceil(cssH * scale))
  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = pW; exportCanvas.height = pH
  const exportCtx = exportCanvas.getContext('2d')
  if (!exportCtx) return null

  for (const layer of [...pixelState.layers].reverse()) {
    if (layer.visible === false) continue
    const g = layer.glyphs[char]; if (!g) continue
    if (!g.some(row => row?.some(v => v))) continue
    const { rows: lr, cols: lc, cellW: lw = 15, cellH: lh = 15, smooth: ls = 0, skew: lsk = 0 } = layer
    const lr2 = ls / 100, lSkew = lsk / 100

    exportCtx.save(); exportCtx.globalAlpha = layer.opacity
    exportCtx.fillStyle = layer.color
    for (let r = 0; r < lr; r++) for (let c = 0; c < lc; c++) {
      if (!g[r]?.[c]) continue
      const { x, y } = layerGetCellPos(layer, c, r)
      exportCtx.save()
      exportCtx.translate((x - minX) * scale, (y - minY) * scale)
      if (lSkew !== 0) exportCtx.transform(1, 0, lSkew, 1, 0, 0)
      shapePath(exportCtx, lw * scale, lh * scale, lr2, layer.shape)
      exportCtx.fill(); exportCtx.restore()
    }
    exportCtx.restore()
  }
  return { canvas: exportCanvas, cssW, cssH, pW, pH, minX, minY }
}


function renderMainCanvas(hoveredCell) {
  currentMode === 'grid' ? gridRenderMainCanvas(hoveredCell) : pixelRenderMainCanvas(hoveredCell)
}

// ─────────────────────────────────────────────
//  GRID THUMBNAIL
// ─────────────────────────────────────────────
function gridRenderThumbnail(char, canvasEl) {
  const glyph = gridGlyphs()[char]
  const { cellColor } = state
  const s = Math.floor(canvasEl.parentElement.offsetWidth)
  const dpr = window.devicePixelRatio || 1
  canvasEl.width = s*dpr; canvasEl.height = s*dpr
  const tc = canvasEl.getContext('2d')
  tc.scale(dpr, dpr)
  tc.fillStyle = THEMES[currentTheme].thumbnailBg
  tc.fillRect(0,0,s,s)

  if (!glyph || !glyph.some(row => row.some(v=>v))) {
    tc.fillStyle = THEMES[currentTheme].placeholderText
    tc.font = `${s*0.52}px 'DM Sans',sans-serif`
    tc.textAlign = 'center'; tc.textBaseline = 'middle'
    tc.fillText(char, s/2, s/2 + s*0.04); return
  }

  // Scale from the logical grid dimensions, not the full canvas
  const lw = GRID_LOGICAL_W(), lh = GRID_LOGICAL_H()
  const pad = 4
  const scale = Math.min((s - pad*2) / lw, (s - pad*2) / lh)
  const tx = pad + (s - pad*2 - lw * scale) / 2
  const ty = pad + (s - pad*2 - lh * scale) / 2

  tc.save()
  tc.translate(tx, ty)
  tc.scale(scale, scale)
  tc.fillStyle = cellColor
  for (const {r, c, path} of gridPaths) {
    if (glyph[r]?.[c]) tc.fill(path)
  }
  tc.restore()
}

// ─────────────────────────────────────────────
//  PIXEL THUMBNAIL
// ─────────────────────────────────────────────
function pixelRenderThumbnail(char, canvasEl) {
  const al = pixelActiveLayer()
  const { rows, cols } = al
  const s = Math.floor(canvasEl.parentElement.offsetWidth)
  const dpr = window.devicePixelRatio || 1
  canvasEl.width = s*dpr; canvasEl.height = s*dpr
  const tc = canvasEl.getContext('2d')
  tc.scale(dpr, dpr)
  tc.fillStyle = THEMES[currentTheme].thumbnailBg
  tc.fillRect(0, 0, s, s)

  const hasAny = pixelState.layers.some(l => l.glyphs[char]?.some(row => row.some(v => v)))
  if (!hasAny) {
    tc.fillStyle = THEMES[currentTheme].placeholderText
    tc.font = `${s*0.52}px 'DM Sans',sans-serif`
    tc.textAlign = 'center'; tc.textBaseline = 'middle'
    tc.fillText(char, s/2, s/2 + s*0.04); return
  }

  const pad = 2
  const csH = Math.floor((s - pad*2) / Math.max(cols, rows))
  const csW = Math.round(csH * (al.cellW||15) / (al.cellH||15))
  ;[...pixelState.layers].reverse().forEach(layer => {
    if (layer.visible === false) return
    const glyph = layer.glyphs[char]; if (!glyph) return
    const lr = layer.rows ?? rows, lc = layer.cols ?? cols
    const lcsH = Math.floor((s - pad*2) / Math.max(lc, lr))
    const lcsW = Math.round(lcsH * (layer.cellW||15) / (layer.cellH||15))
    tc.globalAlpha = layer.opacity
    tc.fillStyle = layer.color
    for (let r = 0; r < lr; r++) {
      for (let c = 0; c < lc; c++) {
        if (!glyph[r]?.[c]) continue
        const x = pad + (s-pad*2-lc*lcsW)/2 + c*lcsW
        const y = pad + (s-pad*2-lr*lcsH)/2 + r*lcsH
        tc.save(); tc.translate(x, y)
        shapePath(tc, lcsW*0.85, lcsH*0.85, (layer.smooth||0)/100, layer.shape)
        tc.fill(); tc.restore()
      }
    }
    tc.globalAlpha = 1
  })
}

function renderThumbnail(char, canvasEl) {
  currentMode === 'grid' ? gridRenderThumbnail(char, canvasEl) : pixelRenderThumbnail(char, canvasEl)
}

function renderAllThumbnails() {
  document.querySelectorAll('#char-grid .char-cell').forEach(cell => {
    const cnv = cell.querySelector('canvas')
    if (cnv) renderThumbnail(cell.dataset.char, cnv)
  })
  updateGlyphCount()
}

// ─────────────────────────────────────────────
//  GRID PREVIEW
// ─────────────────────────────────────────────
function gridRenderPreview() {
  const inp = document.getElementById('preview-input'); if (!inp) return
  const text = inp.value
  const { cellColor } = state
  const lw = GRID_LOGICAL_W(), lh = GRID_LOGICAL_H()
  const wrap = document.getElementById('preview-canvas-wrap')
  const pc = document.getElementById('preview-canvas')
  if (!wrap || !pc) return
  
  const previewH = 48
  const scale = previewH / Math.max(1, lh)
  const charW = lw * scale
  
  const totalW = text.length * charW
  const dpr = window.devicePixelRatio || 1
  pc.width  = Math.max(totalW, wrap.offsetWidth-16) * dpr
  pc.height = previewH * dpr; pc.style.height = previewH + 'px'
  const c2 = pc.getContext('2d'); c2.scale(dpr,dpr); c2.clearRect(0,0,pc.width,pc.height)

  for (let ci = 0; ci < text.length; ci++) {
    const glyph = gridGlyphs()[text[ci]]; if (!glyph) continue
    c2.save()
    c2.translate(ci * charW, 0)
    c2.scale(scale, scale)
    c2.fillStyle = cellColor
    for (const {r, c, path} of gridPaths) {
      if (glyph[r]?.[c]) c2.fill(path)
    }
    c2.restore()
  }
}

// ─────────────────────────────────────────────
//  PIXEL PREVIEW
// ─────────────────────────────────────────────
function pixelRenderPreview() {
  const inp = document.getElementById('preview-input'); if (!inp) return
  const text = inp.value
  const al = pixelActiveLayer()
  const { rows, cols, smooth=0, skew=0 } = al
  const skewFactor = skew / 100
  const wrap = document.getElementById('preview-canvas-wrap')
  const pc = document.getElementById('preview-canvas')
  if (!wrap || !pc) return
  const TH = 4, TW = TH
  const CW = cols*TW, CH = rows*TH
  const totalW = text.length * (CW + 4)
  const dpr = window.devicePixelRatio || 1
  pc.width  = Math.max(totalW, wrap.offsetWidth-16) * dpr
  pc.height = (CH+16) * dpr; pc.style.height = (CH+16)+'px'
  const c2 = pc.getContext('2d'); c2.scale(dpr,dpr); c2.clearRect(0,0,pc.width,pc.height)

  for (let ci = 0; ci < text.length; ci++) {
    const ox = ci*(CW+4)+8
    ;[...pixelState.layers].reverse().forEach(layer => {
      if (layer.visible === false) return
      const glyph = layer.glyphs[text[ci]]; if (!glyph) return
      c2.globalAlpha = layer.opacity
      c2.fillStyle = layer.color
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (!glyph[r]?.[c]) continue
        c2.save(); c2.translate(ox + c*TW, 8 + r*TH)
        if (skewFactor !== 0) c2.transform(1, 0, skewFactor, 1, 0, 0)
        shapePath(c2, TW, TH, smooth/100, layer.shape); c2.fill(); c2.restore()
      }
      c2.globalAlpha = 1
    })
  }
}

function renderPreview() {
  currentMode === 'grid' ? gridRenderPreview() : pixelRenderPreview()
}

// ─────────────────────────────────────────────
//  GLYPH MANAGEMENT
// ─────────────────────────────────────────────
function gridGetCurrentGlyph() {
  const char = CHARSET[currentCharIdx]
  const trueCols = getGridActualCols()
  const glyphs = gridGlyphs()
  if (!glyphs[char])
    glyphs[char] = Array.from({length:state.rows}, ()=>new Array(trueCols).fill(false))
  return glyphs[char]
}

function pixelActiveLayer() {
  return pixelState.layers[pixelState.activeLayerIdx] || pixelState.layers[0]
}

function pixelGetLayerGlyph(layer, char) {
  if (!layer.glyphs[char])
    layer.glyphs[char] = Array.from({length: layer.rows ?? 24}, () => new Array(layer.cols ?? 16).fill(false))
  return layer.glyphs[char]
}

function pixelGetCurrentGlyph() {
  return pixelGetLayerGlyph(pixelActiveLayer(), getCurrentCharKey())
}

function getActiveGlyph() {
  return currentMode === 'grid' ? gridGetCurrentGlyph() : pixelGetCurrentGlyph()
}

// for backward compat inside grid code
function getCurrentGlyph() { return gridGetCurrentGlyph() }

function gridEnsureGlyphSize(oldCols = null) {
  const glyphs = gridGlyphs()
  const trueCols = getGridActualCols()
  CHARSET.forEach(char => {
    const g = glyphs[char]
    if (!g) return
    const srcCols = oldCols !== null ? oldCols : (g[0]?.length || trueCols)
    const srcRows = g.length || state.rows
    if (srcRows === state.rows && srcCols === trueCols) return
    glyphs[char] = Array.from({length: state.rows}, (_, r) => {
      const srcR = Math.min(Math.round(r * srcRows / state.rows), srcRows - 1)
      return Array.from({length: trueCols}, (_, c) => {
        const srcC = Math.min(Math.round(c * srcCols / trueCols), srcCols - 1)
        return g[srcR]?.[srcC] || false
      })
    })
  })
}

function pixelEnsureGlyphSize() {
  const char = getCurrentCharKey()
  pixelState.layers.forEach(layer => {
    const g = layer.glyphs[char]; if (!g) return
    layer.glyphs[char] = Array.from({length: layer.rows ?? 24}, (_, r) =>
      Array.from({length: layer.cols ?? 16}, (_, c) => g[r]?.[c] || false))
  })
}

// ─────────────────────────────────────────────
//  MOUSE INTERACTIONS
// ─────────────────────────────────────────────
let hoveredCell = null

function getScaledPos(e) {
  const rect = canvas.getBoundingClientRect()
  const z = currentMode === 'grid' ? state.zoom : pixelState.zoom
  return {
    px: (e.clientX - rect.left) / z,
    py: (e.clientY - rect.top)  / z
  }
}

canvas.addEventListener('mousedown', e => {
  const {px,py} = getScaledPos(e)
  const cell = getActiveCellFromPoint(px,py); if (!cell) return
  pushHistory()
  isDragging = true
  const glyph = getActiveGlyph()
  dragMode = glyph[cell.r][cell.c] ? 'off' : 'on'
  glyph[cell.r][cell.c] = dragMode === 'on'
  renderMainCanvas(hoveredCell); updateThumbnail(); renderPreview()
})

canvas.addEventListener('mousemove', e => {
  const {px,py} = getScaledPos(e)
  hoveredCell = getActiveCellFromPoint(px,py)
  if (isDragging && hoveredCell) {
    const glyph = getActiveGlyph()
    glyph[hoveredCell.r][hoveredCell.c] = dragMode === 'on'
    updateThumbnail(); renderPreview()
  }
  renderMainCanvas(hoveredCell)
})

canvas.addEventListener('mouseup', ()=>{ isDragging=false; autoSave() })
canvas.addEventListener('mouseleave', ()=>{
  if (isDragging) autoSave()
  isDragging=false; hoveredCell=null; renderMainCanvas(null)
})

// ─────────────────────────────────────────────
//  THEME
// ─────────────────────────────────────────────
function toggleTheme() {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light'
  document.body.classList.toggle('dark', currentTheme === 'dark')
  document.getElementById('theme-toggle').innerHTML = currentTheme==='dark' ? SVG_SUN : SVG_MOON
  renderMainCanvas(hoveredCell); renderAllThumbnails()
}

// ─────────────────────────────────────────────
//  ZOOM
// ─────────────────────────────────────────────
function applyZoom() {
  const z = currentMode === 'grid' ? state.zoom : pixelState.zoom
  document.getElementById('canvas-wrapper').style.transform = `scale(${z})`
  document.getElementById('zoom-display').textContent = Math.round(z * 100) + '%'
}

function zoomIn() {
  if (currentMode==='grid') state.zoom = Math.min(4, +(state.zoom+0.1).toFixed(2))
  else pixelState.zoom = Math.min(4, +(pixelState.zoom+0.1).toFixed(2))
  applyZoom()
}
function zoomOut() {
  if (currentMode==='grid') state.zoom = Math.max(0.1, +(state.zoom-0.1).toFixed(2))
  else pixelState.zoom = Math.max(0.1, +(pixelState.zoom-0.1).toFixed(2))
  applyZoom()
}
function resetZoom() {
  if (currentMode==='grid') state.zoom=1.0; else pixelState.zoom=1.0
  applyZoom()
}

// ─────────────────────────────────────────────
//  MODE SWITCH
// ─────────────────────────────────────────────
function getCurrentCharKey() {
  return currentDocType === 'lettering' ? LETTERING_KEY : CHARSET[currentCharIdx]
}

function applyDocTypeUI() {
  const isLettering = currentDocType === 'lettering'
  document.body.classList.toggle('lettering-mode', isLettering)
  // Disable font export button in lettering mode
  const fontBtn = document.getElementById('btn-export-font')
  if (fontBtn) { fontBtn.disabled = isLettering; fontBtn.style.opacity = isLettering ? '0.4' : ''; fontBtn.style.cursor = isLettering ? 'not-allowed' : '' }
}

function switchMode(mode) {
  currentMode = mode
  document.body.classList.toggle('pixel-mode', mode === 'pixel')
  document.getElementById('btn-mode-grid').classList.toggle('active', mode==='grid')
  document.getElementById('btn-mode-pixel').classList.toggle('active', mode==='pixel')
  updateDocHeader()
  if (mode==='grid') gridEnsureGlyphSize(); else pixelEnsureGlyphSize()
  if (mode === 'pixel') { renderLayerList(); pixelSyncSliders() }
  resizeCanvas(); renderMainCanvas(null); renderAllThumbnails(); renderPreview(); resetZoom()
}

// ─────────────────────────────────────────────
//  GRID CONTROLS
// ─────────────────────────────────────────────
function updateParam(name, val) {
  pushHistory()
  val = parseInt(val) || 0; state[name] = val
  const sl = document.getElementById('sl-'+name), vEl = document.getElementById('v-'+name)
  if (sl) sl.value = val; if (vEl) { if (vEl.tagName==='INPUT') vEl.value=val; else vEl.textContent=val }
  if (name==='rows'||name==='cols') { gridEnsureGlyphSize(); renderAllThumbnails() }
  gridResizeCanvas(); gridRenderMainCanvas(hoveredCell); gridRenderPreview(); gridAutoSave()
}

function updateGridSpecificParam(key, val) {
  pushHistory()
  const type = state.gridType
  if (!state[type]) return
  if (key === 'innerRadius') val = parseInt(val) || 0
  if (key === 'angle') val = parseInt(val) || 0
  const oldCols = getGridActualCols()
  state[type][key] = val
  
  const vEl = document.getElementById('v-'+key)
  if (vEl) { if (vEl.tagName==='INPUT') vEl.value=val; else vEl.textContent=val }
  
  const toggle = document.getElementById('toggle-'+key)
  if (toggle) {
    toggle.querySelectorAll('.sub-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.val === val))
  }

  if (key === 'diagonal') gridEnsureGlyphSize(oldCols)
  gridResizeCanvas(); gridRenderMainCanvas(hoveredCell); renderAllThumbnails(); gridRenderPreview(); gridAutoSave()
}

function setGridType(type) {
  if (state.gridType !== type) pushHistory()
  state.gridType = type
  document.querySelectorAll('.grid-type-btn').forEach(b=>b.classList.toggle('active', b.dataset.type===type))

  const toggle = (id, cond) => { const el = document.getElementById(id); if (el) el.style.display = cond ? 'block' : 'none' }
  toggle('section-diagonal', type === 'triangular')
  toggle('section-org-style', type === 'organic')

  const toggleRow = (id, cond) => { const el = document.getElementById(id); if (el) el.style.display = cond ? 'flex' : 'none' }
  toggleRow('row-gutterX', type === 'rectangular')
  toggleRow('row-gutterY', type === 'rectangular')
  toggleRow('row-ratio', type === 'rectangular')
  toggleRow('row-innerRadius', type === 'polar')
  toggleRow('row-angle', type === 'polar')

  if (type === 'triangular') {
    const val = state.triangular.diagonal
    const toggle = document.getElementById('toggle-diagonal')
    if (toggle) toggle.querySelectorAll('.sub-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.val === val))
  }
  else if (type === 'organic') {
    const val = state.organic.subType
    const toggle = document.getElementById('toggle-subType')
    if (toggle) toggle.querySelectorAll('.sub-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.val === val))
  }
  // Ensure current type's store has correct dimensions (no-op if empty or already correct)
  gridEnsureGlyphSize()

  gridResizeCanvas(); gridRenderMainCanvas(hoveredCell); renderAllThumbnails(); gridRenderPreview(); gridAutoSave()
}

function updateColor(hex) {
  pushHistory()
  state.cellColor = hex
  gridRenderMainCanvas(hoveredCell); renderAllThumbnails(); gridRenderPreview(); gridAutoSave()
}

// ─────────────────────────────────────────────
//  PIXEL CONTROLS
// ─────────────────────────────────────────────
function updatePixelParam(name, val) {
  pushHistory()
  val = parseInt(val) || 0
  pixelActiveLayer()[name] = val
  const sl = document.getElementById('psl-'+name), vEl = document.getElementById('pv-'+name)
  if (sl) sl.value = val; if (vEl) { if (vEl.tagName==='INPUT') vEl.value=val; else vEl.textContent=val }
  if (name==='rows'||name==='cols') { pixelEnsureGlyphSize(); renderAllThumbnails() }
  pixelResizeCanvas(); pixelRenderMainCanvas(hoveredCell); pixelRenderPreview(); pixelAutoSave()
}

function setPixelType(type) {
  pushHistory()
  pixelActiveLayer().shape = type
  document.querySelectorAll('.pixel-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type))
  renderLayerList()
  pixelRenderMainCanvas(hoveredCell); renderAllThumbnails(); pixelRenderPreview(); pixelAutoSave()
}

function updateGridOpacity(val) {
  pushHistory()
  val = Math.max(0, Math.min(100, parseInt(val) || 0))
  if (currentMode === 'grid') {
    state.gridOpacity = val / 100
    const vEl = document.getElementById('v-gridOpacity')
    if (vEl) vEl.textContent = val
    const sl = document.getElementById('sl-gridOpacity')
    if (sl) sl.value = val
    gridRenderMainCanvas(hoveredCell); gridAutoSave()
  } else {
    pixelState.gridOpacity = val / 100
    const vEl = document.getElementById('pv-gridOpacity')
    if (vEl) vEl.textContent = val
    const sl = document.getElementById('psl-gridOpacity')
    if (sl) sl.value = val
    pixelRenderMainCanvas(hoveredCell); pixelAutoSave()
  }
}

function gridOpacityDown() {
  const cur = currentMode === 'grid'
    ? Math.round((state.gridOpacity ?? 1) * 100)
    : Math.round((pixelState.gridOpacity ?? 1) * 100)
  updateGridOpacity(Math.max(0, cur - 10))
}

function gridOpacityUp() {
  const cur = currentMode === 'grid'
    ? Math.round((state.gridOpacity ?? 1) * 100)
    : Math.round((pixelState.gridOpacity ?? 1) * 100)
  updateGridOpacity(Math.min(100, cur + 10))
}

function updatePixelColor(hex) {
  pushHistory()
  pixelActiveLayer().color = hex
  renderLayerList()
  pixelRenderMainCanvas(hoveredCell); renderAllThumbnails(); pixelRenderPreview(); pixelAutoSave()
}

// ─────────────────────────────────────────────
//  PIXEL LAYER MANAGEMENT
// ─────────────────────────────────────────────
function addPixelLayer() {
  pushHistory()
  const al = pixelActiveLayer()
  const n = pixelState.layers.length + 1
  const { rows, cols, cellW, cellH, gapX, gapY, smooth, skew, rowStagger, colStagger } = al
  pixelState.layers.push(makePixelLayer(`Layer ${n}`, 'rect', '#000000',
    { rows, cols, cellW, cellH, gapX, gapY, smooth, skew, rowStagger, colStagger }))
  setActiveLayer(pixelState.layers.length - 1)
}

function duplicatePixelLayer(idx) {
  pushHistory()
  const src = pixelState.layers[idx]
  const copy = JSON.parse(JSON.stringify(src))
  copy.id = Date.now() + Math.random()
  copy.name = src.name + ' copy'
  copy.offsetX = (src.offsetX ?? 0) + 8
  copy.offsetY = (src.offsetY ?? 0) + 8
  pixelState.layers.splice(idx + 1, 0, copy)
  setActiveLayer(idx + 1)
}

function removePixelLayer(idx) {
  if (pixelState.layers.length <= 1) return
  pushHistory()
  pixelState.layers.splice(idx, 1)
  pixelState.activeLayerIdx = Math.min(pixelState.activeLayerIdx, pixelState.layers.length - 1)
  setActiveLayer(pixelState.activeLayerIdx)
}

function setActiveLayer(idx) {
  pixelState.activeLayerIdx = idx
  pixelSyncSliders()
  renderLayerList()
  pixelResizeCanvas(); pixelRenderMainCanvas(hoveredCell); pixelAutoSave()
}

function setLayerOpacity(idx, val) {
  pushHistory()
  pixelState.layers[idx].opacity = Math.max(0, Math.min(1, val / 100))
  renderLayerList()
  pixelRenderMainCanvas(hoveredCell); renderAllThumbnails(); pixelRenderPreview(); pixelAutoSave()
}

function setLayerName(idx, val) {
  if (val.trim()) pixelState.layers[idx].name = val.trim()
  pixelAutoSave()
}

function toggleLayerVisible(idx) {
  pushHistory()
  const l = pixelState.layers[idx]
  l.visible = l.visible === false ? true : false
  renderLayerList()
  pixelRenderMainCanvas(hoveredCell); renderAllThumbnails(); pixelRenderPreview(); pixelAutoSave()
}


function moveLayerUp(idx) {
  if (idx <= 0) return
  pushHistory()
  const layers = pixelState.layers;
  [layers[idx], layers[idx - 1]] = [layers[idx - 1], layers[idx]]
  if (pixelState.activeLayerIdx === idx) pixelState.activeLayerIdx = idx - 1
  else if (pixelState.activeLayerIdx === idx - 1) pixelState.activeLayerIdx = idx
  renderLayerList()
  pixelRenderMainCanvas(hoveredCell); renderAllThumbnails(); pixelRenderPreview(); pixelAutoSave()
}

function moveLayerDown(idx) {
  if (idx >= pixelState.layers.length - 1) return
  pushHistory()
  const layers = pixelState.layers;
  [layers[idx], layers[idx + 1]] = [layers[idx + 1], layers[idx]]
  if (pixelState.activeLayerIdx === idx) pixelState.activeLayerIdx = idx + 1
  else if (pixelState.activeLayerIdx === idx + 1) pixelState.activeLayerIdx = idx
  renderLayerList()
  pixelRenderMainCanvas(hoveredCell); renderAllThumbnails(); pixelRenderPreview(); pixelAutoSave()
}

const SVG_EYE_ON  = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 8C3 4 13 4 15 8C13 12 3 12 1 8Z"/><circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none"/></svg>`
const SVG_EYE_OFF = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 8C3 4 13 4 15 8C13 12 3 12 1 8Z"/><circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none"/><line x1="2" y1="2" x2="14" y2="14"/></svg>`

function hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
}

function renderLayerList() {
  const list = document.getElementById('pixel-layer-list'); if (!list) return
  const n = pixelState.layers.length
  list.innerHTML = pixelState.layers.map((layer, idx) => {
    const hidden = layer.visible === false
    return `
    <div class="layer-item${idx === pixelState.activeLayerIdx ? ' active' : ''}${hidden ? ' layer-hidden' : ''}" onclick="setActiveLayer(${idx})">
      <div class="layer-row1">
        <div class="layer-swatch" style="background:${layer.color};opacity:${hidden ? 0.3 : 1};cursor:pointer" title="Change color"
          onclick="event.stopPropagation();setActiveLayer(${idx});setTimeout(()=>document.getElementById('pixel-color-picker').click(),0)"></div>
        <input class="layer-name-input" value="${layer.name.replace(/"/g,'&quot;')}"
          onclick="event.stopPropagation()"
          onchange="setLayerName(${idx},this.value)">
        <div class="layer-actions" onclick="event.stopPropagation()">
          <button class="layer-icon-btn${hidden ? ' dim' : ''}" title="${hidden ? 'Show' : 'Hide'}" onclick="toggleLayerVisible(${idx})">${hidden ? SVG_EYE_OFF : SVG_EYE_ON}</button>
          <button class="layer-icon-btn" title="Duplicate" onclick="duplicatePixelLayer(${idx})"><svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="3" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="3" y="1" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></button>
          <button class="layer-icon-btn" title="Move up" ${idx === 0 ? 'disabled' : ''} onclick="moveLayerUp(${idx})"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 2L9 7H1Z" fill="currentColor"/></svg></button>
          <button class="layer-icon-btn" title="Move down" ${idx === n-1 ? 'disabled' : ''} onclick="moveLayerDown(${idx})"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 8L1 3H9Z" fill="currentColor"/></svg></button>
          ${n > 1 ? `<button class="layer-del-btn" title="Delete" onclick="removePixelLayer(${idx})">×</button>` : ''}
        </div>
      </div>
      <div class="layer-row2" onclick="event.stopPropagation()">
        <span class="layer-shape-tag">${layer.shape}</span>
        <div class="layer-opacity-wrap">
          <input type="range" class="layer-opacity-slider" min="0" max="100"
            value="${Math.round(layer.opacity * 100)}"
            oninput="setLayerOpacity(${idx},this.value)">
          <span class="layer-opacity-val">${Math.round(layer.opacity * 100)}%</span>
        </div>
      </div>
    </div>`
  }).join('')
}

// ─────────────────────────────────────────────
//  SHARED CONTROLS
// ─────────────────────────────────────────────
function toggleGrid() {
  pushHistory()
  if (currentMode==='grid') state.showGrid=!state.showGrid
  else pixelState.showGrid=!pixelState.showGrid
  renderMainCanvas(hoveredCell)
}

// ── Guide line controls ──
let _guidePanelOpen = false
function toggleGuidePanel() {
  _guidePanelOpen = !_guidePanelOpen
  document.getElementById('btn-guide')?.classList.toggle('active', _guidePanelOpen)
  const panel = document.getElementById('guide-panel')
  if (panel) panel.style.display = _guidePanelOpen ? 'block' : 'none'
  if (_guidePanelOpen) renderGuidePanel()
}

function closeGuidePanel() {
  if (!_guidePanelOpen) return
  _guidePanelOpen = false
  document.getElementById('btn-guide')?.classList.remove('active')
  const panel = document.getElementById('guide-panel')
  if (panel) panel.style.display = 'none'
}

document.addEventListener('mousedown', e => {
  if (!_guidePanelOpen) return
  const panel = document.getElementById('guide-panel')
  const btn = document.getElementById('btn-guide')
  if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) closeGuidePanel()
})

function toggleGuideLines() {
  guideState.enabled = !guideState.enabled
  const sw = document.getElementById('guide-visible-toggle')
  if (sw) { sw.classList.toggle('active', guideState.enabled); sw.textContent = guideState.enabled ? 'ON' : 'OFF' }
  renderMainCanvas(hoveredCell)
}

function addGuideLine(axis) {
  const arr = axis === 'h' ? guideState.hLines : guideState.vLines
  if (arr.length >= 10) return
  arr.push(50)
  renderGuidePanel(); renderMainCanvas(hoveredCell)
}

function removeGuideLine(axis, idx) {
  const arr = axis === 'h' ? guideState.hLines : guideState.vLines
  arr.splice(idx, 1)
  renderGuidePanel(); renderMainCanvas(hoveredCell)
}

function updateGuideLine(axis, idx, val) {
  val = Math.max(0, Math.min(100, parseInt(val) || 0))
  const arr = axis === 'h' ? guideState.hLines : guideState.vLines
  arr[idx] = val
  const el = document.getElementById(`guide-${axis}-val-${idx}`)
  if (el) el.textContent = val + '%'
  renderMainCanvas(hoveredCell)
}

function renderGuidePanel() {
  const sw = document.getElementById('guide-visible-toggle')
  if (sw) sw.classList.toggle('active', guideState.enabled)
  const hList = document.getElementById('guide-h-list')
  const vList = document.getElementById('guide-v-list')
  if (!hList || !vList) return
  const row = (axis, idx, val) => `
    <div class="guide-row">
      <input type="range" class="guide-slider" min="0" max="100" value="${val}"
        oninput="updateGuideLine('${axis}',${idx},this.value)">
      <span class="guide-val" id="guide-${axis}-val-${idx}">${val}%</span>
      <button class="guide-del" onclick="removeGuideLine('${axis}',${idx})">✕</button>
    </div>`
  hList.innerHTML = guideState.hLines.map((v, i) => row('h', i, v)).join('') ||
    `<div class="guide-empty">No lines</div>`
  vList.innerHTML = guideState.vLines.map((v, i) => row('v', i, v)).join('') ||
    `<div class="guide-empty">No lines</div>`
}

function clearGlyph() {
  const char = currentMode==='grid' ? CHARSET[currentCharIdx] : getCurrentCharKey()
  if (currentMode==='grid') {
    gridGlyphs()[char] = Array.from({length:state.rows},()=>new Array(getGridActualCols()).fill(false))
  } else {
    const al = pixelActiveLayer()
    al.glyphs[char] = Array.from({length:al.rows??24},()=>new Array(al.cols??16).fill(false))
  }
  renderMainCanvas(hoveredCell); updateThumbnail(); renderPreview()
}

function randomizeGlyph() {
  const char = currentMode==='grid' ? CHARSET[currentCharIdx] : getCurrentCharKey()
  const threshold = currentMode==='grid' ? 0.55 : 0.65
  if (currentMode==='grid') {
    gridGlyphs()[char] = Array.from({length:state.rows},()=>Array.from({length:getGridActualCols()},()=>Math.random()>threshold))
  } else {
    const al = pixelActiveLayer()
    al.glyphs[char] = Array.from({length:al.rows??24},()=>Array.from({length:al.cols??16},()=>Math.random()>threshold))
  }
  renderMainCanvas(hoveredCell); updateThumbnail(); renderPreview(); setStatus('Randomized: '+char)
}

function prevChar() { currentCharIdx=(currentCharIdx-1+CHARSET.length)%CHARSET.length; switchChar() }
function nextChar() { currentCharIdx=(currentCharIdx+1)%CHARSET.length; switchChar() }

function switchChar() {
  const char = CHARSET[currentCharIdx]
  const disp = document.getElementById('current-char-display')
  if (disp) disp.textContent = char
  const expectedTab = currentCharIdx < CHARSET_LATIN.length ? 'latin' : 'korean'
  if (expectedTab !== activeTab) switchCharTab(expectedTab)
  if (currentMode==='grid') gridEnsureGlyphSize(); else pixelEnsureGlyphSize()
  resizeCanvas(); renderMainCanvas(hoveredCell); updateActiveCharCell(); setStatus('Editing: '+char)
}

function updateActiveCharCell() {
  document.querySelectorAll('.char-cell').forEach(cell=>
    cell.classList.toggle('active', cell.dataset.char===CHARSET[currentCharIdx]))
}

function updateThumbnail() {
  const char = CHARSET[currentCharIdx]
  const cell = document.querySelector(`.char-cell[data-char="${CSS.escape(char)}"]`)
  if (cell) { const cnv=cell.querySelector('canvas'); if(cnv) renderThumbnail(char,cnv) }
  updateGlyphCount()
}

function updateGlyphCount() {
  const isDrawn = c => {
    if (currentMode==='grid') return gridGlyphs()[c]?.some(row=>row.some(v=>v))
    return pixelState.layers.some(l => l.glyphs[c]?.some(row=>row.some(v=>v)))
  }
  if (activeTab==='latin') {
    document.getElementById('glyph-count').textContent = `${CHARSET_LATIN.filter(isDrawn).length} / ${CHARSET_LATIN.length}`
  } else {
    document.getElementById('glyph-count').textContent = `${CHARSET_KOREAN.filter(isDrawn).length} / ${CHARSET_KOREAN.length}`
  }
}

function setStatus(msg) { document.getElementById('status-bar').textContent = msg }

// ─────────────────────────────────────────────
//  SAVE / LOAD
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  DOCUMENT STORAGE (Figma-style named docs)
// ─────────────────────────────────────────────
const DOCS_KEY = 'gridtype_documents_v1'

function docsGetAll() {
  try { return JSON.parse(localStorage.getItem(DOCS_KEY)) || [] } catch { return [] }
}

function updateDocHeader() {
  const el = document.getElementById('current-doc-name')
  if (el) el.textContent = getCurrentDocName()
}

function docsSave(name) {
  setCurrentDocName(name || 'Untitled')
  updateDocHeader()
  const docs = docsGetAll()
  const isGrid = currentMode === 'grid'
  const _previewText = document.getElementById('preview-large-input')?.value || ''
  const config = isGrid
    ? { rows:state.rows,cols:state.cols,gutterX:state.gutterX,gutterY:state.gutterY,
        ratio:state.ratio,gridType:state.gridType,cellColor:state.cellColor,
        polar:state.polar,triangular:state.triangular,organic:state.organic,
        previewText: _previewText }
    : { showGrid: pixelState.showGrid, gridOpacity: pixelState.gridOpacity,
        layers: JSON.parse(JSON.stringify(pixelState.layers)),
        activeLayerIdx: pixelState.activeLayerIdx,
        previewText: _previewText }
  const doc = {
    id: Date.now(),
    name: name || 'Untitled',
    mode: currentMode,
    config,
    glyphs: isGrid ? JSON.parse(JSON.stringify(state.glyphsByType)) : null,
    savedAt: new Date().toLocaleString()
  }
  // Update if same name and mode exists, else append
  const idx = docs.findIndex(d => d.name === doc.name && d.mode === doc.mode)
  if (idx >= 0) docs[idx] = doc; else docs.unshift(doc)
  localStorage.setItem(DOCS_KEY, JSON.stringify(docs))
  setStatus('📄 Saved ' + (isGrid?'grid':'pixel') + ' document: ' + doc.name)
  renderDocList()
}

function docsLoad(id) {
  const doc = docsGetAll().find(d => d.id === id); if (!doc) return
  if (doc.mode !== currentMode) switchMode(doc.mode)
  if (doc.mode === 'grid') {
    Object.assign(state, doc.config)
    migrateGridGlyphs(doc)
    gridSyncSliders(); setGridType(state.gridType)
    const inp = document.getElementById('preview-large-input')
    if (inp && doc.config?.previewText !== undefined) inp.value = doc.config.previewText
  } else {
    migratePixelLoad(doc)
    pixelSyncSliders()
  }
  resizeCanvas(); renderMainCanvas(null); renderAllThumbnails(); renderPreview(); resetZoom()
  setCurrentDocName(doc.name); updateDocHeader()
  setStatus('📂 Loaded: ' + doc.name)
  closeDocManager()
}

function docsRename(id) {
  const docs = docsGetAll()
  const idx = docs.findIndex(d => d.id === id)
  if (idx < 0) return
  const oldName = docs[idx].name
  const newName = prompt('Enter new document name:', oldName)
  if (newName && newName.trim() && newName !== oldName) {
    const finalName = newName.trim()
    // Update name in storage
    docs[idx].name = finalName
    localStorage.setItem(DOCS_KEY, JSON.stringify(docs))
    // If it's the currently active doc, update the global state
    if (oldName === getCurrentDocName()) {
      setCurrentDocName(finalName)
      updateDocHeader()
    }
    renderDocList()
    setStatus('✏️ Renamed: ' + finalName)
  }
}

function docsDelete(id) {
  const docs = docsGetAll()
  const doc = docs.find(d => d.id === id)
  if (!doc) return
  if (confirm(`Delete document "${doc.name}"?`)) {
    const updated = docs.filter(d => d.id !== id)
    localStorage.setItem(DOCS_KEY, JSON.stringify(updated))
    renderDocList()
    setStatus('🗑️ Document deleted')
  }
}

function openDocManager() {
  document.getElementById('doc-manager').classList.add('open')
  renderDocList()
}

function closeDocManager() {
  document.getElementById('doc-manager').classList.remove('open')
}

function renderDocList() {
  const list = document.getElementById('doc-list')
  if (!list) return
  const allDocs = docsGetAll()
  const docs = allDocs.filter(d => d.mode === currentMode)
  
  if (docs.length === 0) {
    list.innerHTML = `<div class="doc-empty">No saved ${currentMode} documents yet</div>`; return
  }
  list.innerHTML = docs.map(d => `
    <div class="doc-item" data-id="${d.id}">
      <div class="doc-info" onclick="docsLoad(${d.id})">
        <div class="doc-name">${d.name}</div>
        <div class="doc-meta"><span class="doc-mode-tag">${d.mode.toUpperCase()}</span>${d.savedAt}</div>
      </div>
      <div class="doc-actions">
        <button class="doc-action-btn" onclick="docsRename(${d.id})" title="Rename">✎</button>
        <button class="doc-action-btn del" onclick="docsDelete(${d.id})" title="Delete">✕</button>
      </div>
    </div>`).join('')
}

function saveNewDoc() {
  const inp = document.getElementById('doc-name-input')
  const name = inp.value.trim() || 'Untitled'
  docsSave(name)
  inp.value = ''
  closeDocManager()
}

function createNewDoc() {
  if (!currentUser) { setStatus('Log in to create documents'); return }
  if (confirm('Create a new document? Unsaved changes will be lost.')) {
    if (currentMode === 'grid') {
      GRID_TYPES.forEach(t => { state.glyphsByType[t] = makeGlyphStore() })
    }
    if (currentMode === 'pixel') {
      pixelState.layers = [makePixelLayer()]
      pixelState.activeLayerIdx = 0
      renderLayerList(); pixelSyncSliders()
    }
    currentCloudDocId = null
    clearTimeout(autoSaveTimer)
    setCurrentDocName('Untitled')
    updateDocHeader()
    setStatus('New document — enter a name and click Save')
  }
}

function saveCurrentDoc() {
  if (!currentUser) { setStatus('Log in to save your work'); return }
  if (!currentCloudDocId) {
    openDocManagerPatched()
  } else {
    docsSaveCloud(getCurrentDocName())
  }
}

function clearAllGlyphs() {
  if (currentMode==='grid') {
    CHARSET.forEach(c => { gridGlyphs()[c] = Array.from({length:state.rows},()=>new Array(getGridActualCols()).fill(false)) })
  } else {
    pixelState.layers.forEach(layer => {
      CHARSET.forEach(c => { layer.glyphs[c] = Array.from({length:layer.rows},()=>new Array(layer.cols).fill(false)) })
    })
  }
  resizeCanvas(); renderMainCanvas(null); renderAllThumbnails(); renderPreview()
}

function handleLoadFile(e) {
  const file = e.target.files[0]; if (!file) return
  const reader = new FileReader()
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result)
      const mode = data.mode || 'grid'
      if (mode==='grid') {
        Object.assign(state, data.config)
        migrateGridGlyphs(data)
        gridSyncSliders(); setGridType(state.gridType)
      } else {
        migratePixelLoad(data)
        pixelSyncSliders()
      }
      if (mode!==currentMode) switchMode(mode)
      else { resizeCanvas(); renderMainCanvas(null); renderAllThumbnails(); renderPreview(); resetZoom() }
      setStatus('Project loaded')
    } catch { setStatus('Load failed: invalid file format') }
  }
  reader.readAsText(file); e.target.value=''
}

function gridSyncSliders() {
  ;['rows','cols','gutterX','gutterY','smooth','skew','ratio'].forEach(k=>{
    const sl=document.getElementById('sl-'+k), vEl=document.getElementById('v-'+k)
    const val = state[k]??0
    if(sl) sl.value=val; if(vEl) { if(vEl.tagName==='INPUT') vEl.value=val; else vEl.textContent=val }
  })
  const irSl=document.getElementById('sl-innerRadius'), irV=document.getElementById('v-innerRadius')
  if(irSl) irSl.value=state.polar.innerRadius; if(irV) irV.value=state.polar.innerRadius
  const angSl=document.getElementById('sl-angle'), angV=document.getElementById('v-angle')
  if(angSl) angSl.value=state.polar.angle||0; if(angV) angV.value=state.polar.angle||0
  document.getElementById('color-picker').value=state.cellColor||'#000000'
  const goV = Math.round((state.gridOpacity ?? 1) * 100)
  const goSl = document.getElementById('sl-gridOpacity'), goVal = document.getElementById('v-gridOpacity')
  if (goSl) goSl.value = goV; if (goVal) goVal.textContent = goV
}

function pixelSyncSliders() {
  const al = pixelActiveLayer()
  ;['rows','cols','cellW','cellH','gapX','gapY','smooth','skew','rowStagger','colStagger','offsetX','offsetY'].forEach(k=>{
    const sl=document.getElementById('psl-'+k), vEl=document.getElementById('pv-'+k)
    const val = al?.[k] ?? 0
    if(sl) sl.value=val; if(vEl) { if(vEl.tagName==='INPUT') vEl.value=val; else vEl.textContent=val }
  })
  const goV = Math.round((pixelState.gridOpacity ?? 1) * 100)
  const goSl = document.getElementById('psl-gridOpacity'), goVal = document.getElementById('pv-gridOpacity')
  if (goSl) goSl.value = goV; if (goVal) goVal.textContent = goV
  document.getElementById('pixel-color-picker').value = al?.color || '#000000'
  document.querySelectorAll('.pixel-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === al?.shape))
  renderLayerList()
}

// ─────────────────────────────────────────────
//  AUTO SAVE / LOAD
// ─────────────────────────────────────────────
const GRID_KEY  = 'gridtype_grid_v2'
const PIXEL_KEY = 'gridtype_pixel_v1'

function autoSave() { scheduleCloudAutoSave() }
function gridAutoSave() { scheduleCloudAutoSave() }
function pixelAutoSave() { scheduleCloudAutoSave() }

function scheduleCloudAutoSave() {
  if (!currentUser) return
  if (!currentCloudDocId) { setStatus('Unsaved — click Save to save this document'); return }
  clearTimeout(autoSaveTimer)
  autoSaveTimer = setTimeout(async () => {
    const payload = cloudDocPayload(getCurrentDocName())
    const { error } = await supabase.from('documents').update(payload).eq('id', currentCloudDocId)
    if (!error) setStatus('Saved · ' + new Date().toLocaleTimeString())
  }, 2500)
}

function gridAutoLoad() { return false }
function pixelAutoLoad() { return false }

function migratePixelLoad(data) {
  const cfg = data.config || {}
  const { layers, activeLayerIdx, showGrid, gridOpacity,
    rows=24, cols=16, cellW=15, cellH=15, gapX=1, gapY=1,
    smooth=0, skew=0, rowStagger=0, colStagger=0,
    pixelType, cellColor } = cfg
  if (showGrid !== undefined) pixelState.showGrid = showGrid
  if (gridOpacity !== undefined) pixelState.gridOpacity = gridOpacity
  const globalParams = { rows, cols, cellW, cellH, gapX, gapY, smooth, skew, rowStagger, colStagger }
  if (layers) {
    pixelState.layers = layers
    pixelState.activeLayerIdx = activeLayerIdx || 0
    // Backward compat: old layers had no per-layer params → copy from global config
    pixelState.layers.forEach(l => {
      if (!('rows' in l)) Object.assign(l, globalParams)
      if (!('offsetX' in l)) { l.offsetX = 0; l.offsetY = 0 }
      CHARSET.forEach(c => { if (!(c in l.glyphs)) l.glyphs[c] = null })
    })
  } else {
    const oldGlyphs = data.glyphs || {}
    CHARSET.forEach(c => { if (!(c in oldGlyphs)) oldGlyphs[c] = null })
    pixelState.layers = [{ id: Date.now(), name: 'Layer 1',
      shape: pixelType||'rect', color: cellColor||'#000000',
      opacity: 1.0, glyphs: oldGlyphs, ...globalParams }]
    pixelState.activeLayerIdx = 0
  }
  // Restore preview text if saved
  const inp = document.getElementById('preview-large-input')
  if (inp && cfg.previewText !== undefined) inp.value = cfg.previewText
}


function migrateGridGlyphs(doc) {
  const g = doc.glyphs
  if (g && 'rectangular' in g) {
    // New per-type format stored under glyphs field
    state.glyphsByType = g
  } else if (g) {
    // Old format: single char-keyed store → put into the saved gridType's bucket
    const t = state.gridType || 'rectangular'
    state.glyphsByType = { rectangular: makeGlyphStore(), polar: makeGlyphStore(), triangular: makeGlyphStore(), organic: makeGlyphStore() }
    state.glyphsByType[t] = g
  } else {
    state.glyphsByType = { rectangular: makeGlyphStore(), polar: makeGlyphStore(), triangular: makeGlyphStore(), organic: makeGlyphStore() }
  }
  ensureGlyphStores()
}

// ─────────────────────────────────────────────
//  SVG EXPORT
// ─────────────────────────────────────────────
function buildSVGPaths(glyph, opts) {
  const { rows, cols, gutterX=0, gutterY=0, type, smooth=0, cellColor, ratio } = opts
  const CS_H = 50, CS_W = CS_H * (ratio/100), r2 = smooth/100
  const paths = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!glyph?.[r]?.[c]) continue
    const x=c*(CS_W+(gutterX||0)), y=r*(CS_H+(gutterY||0)), cx2=x+CS_W/2, cy2=y+CS_H/2
    if (type==='rect') {
      paths.push(`<rect x="${x}" y="${y}" width="${CS_W}" height="${CS_H}" rx="${r2*Math.min(CS_W,CS_H)*0.5}" fill="${cellColor}"/>`)
    } else if (type==='circle') {
      paths.push(`<ellipse cx="${cx2}" cy="${cy2}" rx="${CS_W/2}" ry="${CS_H/2}" fill="${cellColor}"/>`)
    } else if (type==='diamond') {
      paths.push(`<polygon points="${cx2},${y} ${x+CS_W},${cy2} ${cx2},${y+CS_H} ${x},${cy2}" fill="${cellColor}"/>`)
    } else if (type==='ring') {
      const hs=0.65-r2*0.45
      const rx=CS_W/2,ry=CS_H/2,rxi=CS_W/2*hs,ryi=CS_H/2*hs
      const it=cy2-CS_H/2*hs,ib=cy2+CS_H/2*hs
      paths.push(`<path fill-rule="nonzero" fill="${cellColor}" d="M${cx2},${y} A${rx},${ry} 0 0,1 ${cx2},${y+CS_H} A${rx},${ry} 0 0,1 ${cx2},${y} Z M${cx2},${it} A${rxi},${ryi} 0 0,0 ${cx2},${ib} A${rxi},${ryi} 0 0,0 ${cx2},${it} Z"/>`)
    } else if (type==='star8') {
      const pts=[], ix=CS_W*(0.2+r2*0.2), iy=CS_H*(0.2+r2*0.2)
      for(let i=0;i<16;i++){const a=i*Math.PI/8-Math.PI/2,outer=i%2===0;pts.push(`${cx2+Math.cos(a)*(outer?CS_W/2:ix)},${cy2+Math.sin(a)*(outer?CS_H/2:iy)}`)}
      paths.push(`<polygon points="${pts.join(' ')}" fill="${cellColor}"/>`)
    } else if (type==='star4') {
      const pts=[], ix=CS_W*(0.08+r2*0.40), iy=CS_H*(0.08+r2*0.40)
      for(let i=0;i<8;i++){const a=i*Math.PI/4-Math.PI/2,outer=i%2===0;pts.push(`${cx2+Math.cos(a)*(outer?CS_W/2:ix)},${cy2+Math.sin(a)*(outer?CS_H/2:iy)}`)}
      paths.push(`<polygon points="${pts.join(' ')}" fill="${cellColor}"/>`)
    } else if (type==='cross') {
      const ox=CS_W*0.35*(1-r2*0.3), oy=CS_H*0.35*(1-r2*0.3)
      paths.push(`<rect x="${x}" y="${y+oy}" width="${CS_W}" height="${CS_H-2*oy}" fill="${cellColor}"/><rect x="${x+ox}" y="${y}" width="${CS_W-2*ox}" height="${CS_H}" fill="${cellColor}"/>`)
    } else {
      paths.push(`<rect x="${x}" y="${y}" width="${CS_W}" height="${CS_H}" fill="${cellColor}"/>`)
    }
  }
  return paths.join('\n')
}

// Convert a single pixel cell to an SVG element string.
// Shape is defined at origin (0,0); caller wraps in <g transform="translate(x,y)...">.
function cellShapeSVGStr(w, h, r2, type) {
  const n = v => parseFloat(v.toFixed(3))
  const cx = n(w/2), cy = n(h/2)
  switch (type) {
    case 'circle':
      return `<ellipse cx="${cx}" cy="${cy}" rx="${n(w/2)}" ry="${n(h/2)}"/>`
    case 'diamond': {
      const hw = cx, hh = cy, k = r2 * 0.45
      return `<path d="M${n(hw*(1+k))},${n(hh*k)} Q${n(w)},${n(hh)} ${n(hw*(2-k))},${n(hh*(1+k))} Q${n(hw)},${n(h)} ${n(hw*(1-k))},${n(hh*(2-k))} Q0,${n(hh)} ${n(hw*k)},${n(hh*(1-k))} Q${n(hw)},0 Z"/>`
    }
    case 'cross': {
      const ox = n(w*0.35*(1-r2*0.3)), oy = n(h*0.35*(1-r2*0.3))
      const nw = n(w), nh = n(h)
      return `<path d="M${ox},0 H${n(w-ox)} V${oy} H${nw} V${n(h-oy)} H${n(w-ox)} V${nh} H${ox} V${n(h-oy)} H0 V${oy} H${ox} Z"/>`
    }
    case 'star4': {
      const ix = w*(0.08+r2*0.40), iy = h*(0.08+r2*0.40)
      const pts = Array.from({length:8},(_,i)=>{const a=i*Math.PI/4-Math.PI/2,o=i%2===0;return `${n(cx+Math.cos(a)*(o?w/2:ix))},${n(cy+Math.sin(a)*(o?h/2:iy))}`})
      return `<polygon points="${pts.join(' ')}"/>`
    }
    case 'star8': {
      const ix = w*(0.2+r2*0.2), iy = h*(0.2+r2*0.2)
      const pts = Array.from({length:16},(_,i)=>{const a=i*Math.PI/8-Math.PI/2,o=i%2===0;return `${n(cx+Math.cos(a)*(o?w/2:ix))},${n(cy+Math.sin(a)*(o?h/2:iy))}`})
      return `<polygon points="${pts.join(' ')}"/>`
    }
    case 'ring': {
      const hs = 0.65 - r2*0.45
      const rx = n(w/2), ry = n(h/2)
      const rxi = n(w/2*hs), ryi = n(h/2*hs)
      const it = n(cy - h/2*hs), ib = n(cy + h/2*hs)
      // outer clockwise, inner counter-clockwise → nonzero fills ring correctly
      return `<path fill-rule="nonzero" d="M${cx},0 A${rx},${ry} 0 0,1 ${cx},${n(h)} A${rx},${ry} 0 0,1 ${cx},0 Z M${cx},${it} A${rxi},${ryi} 0 0,0 ${cx},${ib} A${rxi},${ryi} 0 0,0 ${cx},${it} Z"/>`
    }
    case 'heart': {
      const top = n(h*0.28)
      return `<path d="M${cx},${top} C${cx},${n(h*0.06)} ${n(w)},${n(h*0.06)} ${n(w)},${n(h*0.36)} C${n(w)},${n(h*0.64)} ${cx},${n(h*0.82)} ${cx},${n(h)} C${cx},${n(h*0.82)} 0,${n(h*0.64)} 0,${n(h*0.36)} C0,${n(h*0.06)} ${cx},${n(h*0.06)} ${cx},${top} Z"/>`
    }
    default: // rect
      return `<rect x="0" y="0" width="${n(w)}" height="${n(h)}" rx="${n(r2*Math.min(w,h)*0.5)}"/>`
  }
}

// Build a fully-vector SVG for pixel mode — no embedded rasters.
function buildPixelModeSVG(char) {
  const layers = [...pixelState.layers].reverse()
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  layers.forEach(layer => {
    if (layer.visible === false) return
    const g = layer.glyphs[char]; if (!g) return
    const { rows: lr, cols: lc, cellW: lw=15, cellH: lh=15 } = layer
    for (let r=0;r<lr;r++) for (let c=0;c<lc;c++) {
      if (!g[r]?.[c]) continue
      const {x,y} = layerGetCellPos(layer,c,r)
      minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x+lw);maxY=Math.max(maxY,y+lh)
    }
  })
  if (!isFinite(minX)) return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"></svg>`
  const W = Math.ceil(maxX-minX), H = Math.ceil(maxY-minY)
  const defs=[], groups=[]

  layers.forEach((layer, li) => {
    if (layer.visible === false) return
    const g = layer.glyphs[char]; if (!g) return
    if (!g.some(row=>row?.some(v=>v))) return
    const { rows:lr, cols:lc, cellW:lw=15, cellH:lh=15, smooth:ls=0, skew:lsk=0, shape, color, opacity } = layer
    const r2=ls/100, skewF=lsk/100

    const cells=[]
    for (let r=0;r<lr;r++) for (let c=0;c<lc;c++) {
      if (!g[r]?.[c]) continue
      const {x,y}=layerGetCellPos(layer,c,r)
      const tx=parseFloat((x-minX).toFixed(3)), ty=parseFloat((y-minY).toFixed(3))
      const mat = skewF!==0
        ? `translate(${tx},${ty}) matrix(1,0,${parseFloat(skewF.toFixed(4))},1,0,0)`
        : `translate(${tx},${ty})`
      cells.push(`<g transform="${mat}">${cellShapeSVGStr(lw,lh,r2,shape)}</g>`)
    }
    if (!cells.length) return

    groups.push(`<g fill="${color}" opacity="${opacity}">\n${cells.join('\n')}\n</g>`)
  })

  const defsStr = defs.length ? `<defs>\n${defs.join('\n')}\n</defs>\n` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${defsStr}${groups.join('\n')}\n</svg>`
}

// Build a vector SVG for the current preview text (pixel mode only).
// Replicates the exact layout of renderLargePreviewPixel but outputs <path> elements.
function buildPreviewSVG() {
  if (currentMode !== 'pixel') return null
  const text = document.getElementById('preview-large-input')?.value || ''
  if (!text) return null
  const targetH  = parseInt(document.getElementById('preview-size-slider')?.value  || 120)
  const lineHPct = parseInt(document.getElementById('preview-lineh-slider')?.value || 130)
  const lspc     = parseInt(document.getElementById('preview-lspc-slider')?.value  || 0)

  const al = pixelActiveLayer()
  const fullCssH  = al ? (al.rows * (al.cellH ?? 15)) : 100
  const blankCssW = al ? (al.cols * (al.cellW ?? 15)) : 60
  const cssScale  = targetH / fullCssH
  const extra     = (lspc / 100) * targetH
  const lineH     = targetH * (lineHPct / 100)
  const lines     = text.split('\n')

  // Pre-compute bounding box for each unique character
  const uniqueChars = [...new Set(text.replace(/\n/g, ''))]
  const charBBox = new Map()
  for (const ch of uniqueChars) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const layer of pixelState.layers) {
      if (layer.visible === false) continue
      const g = layer.glyphs[ch]; if (!g) continue
      const { rows: lr, cols: lc, cellW: lw = 15, cellH: lh = 15 } = layer
      for (let r = 0; r < lr; r++) for (let c = 0; c < lc; c++) {
        if (!g[r]?.[c]) continue
        const { x, y } = layerGetCellPos(layer, c, r)
        minX = Math.min(minX, x); minY = Math.min(minY, y)
        maxX = Math.max(maxX, x + lw); maxY = Math.max(maxY, y + lh)
      }
    }
    if (isFinite(minX)) charBBox.set(ch, { minX, minY, cssW: maxX - minX, cssH: maxY - minY })
  }

  // Line widths for alignment
  const lineWidths = lines.map(line =>
    [...line].reduce((s, ch, i) => {
      const bb = charBBox.get(ch)
      return s + (bb ? bb.cssW * cssScale : blankCssW * cssScale) + (i > 0 ? extra : 0)
    }, 0))
  const totalW = Math.max(4, ...lineWidths)
  const totalH = lines.length === 1 ? targetH : (lines.length - 1) * lineH + targetH

  const svgParts = []

  lines.forEach((line, li) => {
    if (!line) return
    const yOff = li * lineH
    const lineW = lineWidths[li]
    let x = previewAlign === 'right'  ? totalW - lineW
           : previewAlign === 'center' ? (totalW - lineW) / 2
           : 0

    ;[...line].forEach((ch, ci) => {
      const bb = charBBox.get(ch)
      if (!bb) { x += blankCssW * cssScale; if (ci < line.length - 1) x += extra; return }

      const charX = x
      ;[...pixelState.layers].reverse().forEach(layer => {
        if (layer.visible === false) return
        const g = layer.glyphs[ch]; if (!g) return
        if (!g.some(row => row?.some(v => v))) return
        const { rows: lr, cols: lc, cellW: lw = 15, cellH: lh = 15,
                smooth: ls = 0, skew: lsk = 0, shape, color, opacity } = layer
        const r2 = ls / 100, skewF = lsk / 100
        const cells = []
        for (let r = 0; r < lr; r++) for (let c = 0; c < lc; c++) {
          if (!g[r]?.[c]) continue
          const { x: cx, y: cy } = layerGetCellPos(layer, c, r)
          const tx = +((cx - bb.minX) * cssScale + charX).toFixed(3)
          const ty = +(cy * cssScale + yOff).toFixed(3)
          const tfm = skewF !== 0
            ? `translate(${tx},${ty}) scale(${cssScale.toFixed(6)}) matrix(1,0,${skewF.toFixed(4)},1,0,0)`
            : `translate(${tx},${ty}) scale(${cssScale.toFixed(6)})`
          cells.push(`<g transform="${tfm}">${cellShapeSVGStr(lw, lh, r2, shape)}</g>`)
        }
        if (cells.length) svgParts.push(`<g fill="${color}" opacity="${opacity}">\n${cells.join('\n')}\n</g>`)
      })

      x += bb.cssW * cssScale
      if (ci < line.length - 1) x += extra
    })
  })

  const W = Math.ceil(totalW), H = Math.ceil(totalH)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${svgParts.join('\n')}\n</svg>`
}

function downloadSVG() {
  // Preview mode: generate vector SVG directly from pixel cells
  if (previewOpen) {
    const svgContent = buildPreviewSVG()
    if (!svgContent) { setStatus('Nothing to export'); return }
    const blob = new Blob([svgContent], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${getCurrentDocName()}-preview.svg`; a.click()
    URL.revokeObjectURL(url); setStatus('SVG exported: preview')
    return
  }
  const char = currentMode === 'grid' ? CHARSET[currentCharIdx] : getCurrentCharKey()
  let svgContent
  if (currentMode === 'grid') {
    const glyph = gridGlyphs()[char]
    const opts = { rows:state.rows, cols:state.cols, gutterX:state.gutterX, gutterY:state.gutterY,
        type:state.gridType, smooth:state.smooth, cellColor:state.cellColor, ratio:state.ratio }
    const CS_H=50, CS_W=CS_H*(opts.ratio/100)
    const W=opts.cols*CS_W+(opts.cols-1)*(opts.gutterX||0)
    const H=opts.rows*CS_H+(opts.rows-1)*(opts.gutterY||0)
    svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${buildSVGPaths(glyph,opts)}\n</svg>`
  } else {
    svgContent = buildPixelModeSVG(char)
  }
  const blob=new Blob([svgContent],{type:'image/svg+xml'})
  const url=URL.createObjectURL(blob)
  const svgSlug = char === '/' ? 'slash' : char === LETTERING_KEY ? getCurrentDocName() : char
  const a=document.createElement('a'); a.href=url; a.download=`${getCurrentDocName()}-${svgSlug}.svg`; a.click()
  URL.revokeObjectURL(url); setStatus('SVG exported')
}

function downloadPNG() {
  // Preview mode: export the preview canvas directly
  if (previewOpen) {
    const pc = document.getElementById('preview-large-canvas')
    if (!pc || pc.width === 0 || pc.height === 0) { setStatus('Nothing to export'); return }
    pc.toBlob(blob => {
      if (!blob) { setStatus('PNG export failed'); return }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${getCurrentDocName()}-preview.png`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      setStatus('PNG exported: preview')
    }, 'image/png')
    return
  }
  const char = currentMode === 'grid' ? CHARSET[currentCharIdx] : getCurrentCharKey()
  const fname = `${getCurrentDocName()}-${char === '/' || char === LETTERING_KEY ? getCurrentDocName() : char}.png`
  const triggerBlob = (cvs) => {
    cvs.toBlob(blob => {
      if (!blob) { setStatus('PNG export failed'); return }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = fname
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      setStatus('PNG exported: ' + char)
    }, 'image/png')
  }
  if (currentMode !== 'pixel') {
    // Grid mode: render current glyph to an offscreen canvas (avoids taint issues)
    const offG = document.createElement('canvas')
    offG.width = canvas.width; offG.height = canvas.height
    const gCtx = offG.getContext('2d')
    gCtx.drawImage(canvas, 0, 0)
    triggerBlob(offG); return
  }
  // Pixel mode: render character at 4× resolution with padding
  const scale = 4
  const result = pixelRenderCharToCanvas(char, scale)
  if (!result) { setStatus('Nothing to export'); return }
  const { canvas: pxCanvas } = result
  const pad = Math.round(4 * scale)
  const out = document.createElement('canvas')
  out.width = pxCanvas.width + pad * 2; out.height = pxCanvas.height + pad * 2
  out.getContext('2d').drawImage(pxCanvas, pad, pad)
  triggerBlob(out)
}

function loadScript(src) {
  return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s) })
}

// ─────────────────────────────────────────────
//  FONT EXPORT  (canvas-trace approach — exactly matches on-screen visuals)
// ─────────────────────────────────────────────
const OPENTYPE_CDN = 'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js'
let _fexFmt = 'otf', _fexChars = 'designed'

function openFontExportModal() {
  document.getElementById('font-export-name').value = getCurrentDocName()
  _fexFmt = 'otf'; _fexChars = 'designed'
  document.querySelectorAll('#font-export-modal .fopt').forEach(b => {
    b.classList.toggle('active',
      (b.closest('#fex-chars-opts') ? b.dataset.val === 'designed' : b.dataset.val === 'otf'))
  })
  _updateFexInfo()
  document.getElementById('font-export-modal').style.display = 'flex'
}

function closeFontExportModal() {
  document.getElementById('font-export-modal').style.display = 'none'
}

function selectFontOpt(btn, group) {
  btn.closest('.fex-opts').querySelectorAll('.fopt').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  if (group === 'fmt') _fexFmt = btn.dataset.val
  else _fexChars = btn.dataset.val
  _updateFexInfo()
}

function _fexGetChars() {
  if (currentMode !== 'pixel') return []
  const pool = _fexChars === 'latin' ? CHARSET_LATIN
              : _fexChars === 'korean' ? CHARSET_KOREAN
              : CHARSET
  if (_fexChars === 'designed') {
    return CHARSET.filter(c => pixelState.layers.some(l => {
      const g = l.glyphs[c]; return g?.some(row => row?.some(v => v))
    }))
  }
  return pool
}

function _updateFexInfo() {
  const el = document.getElementById('font-export-info'); if (!el) return
  if (currentMode !== 'pixel') { el.textContent = 'Switch to Pixel mode to export font'; return }
  const chars = _fexGetChars()
  const designed = chars.filter(c => pixelState.layers.some(l => {
    const g = l.glyphs[c]; return g?.some(row => row?.some(v => v))
  }))
  el.textContent = `${chars.length} glyphs (${designed.length} designed, ${chars.length - designed.length} blank)`
}

function _pixelCharBBox(char) {
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity
  for (const layer of pixelState.layers) {
    if (layer.visible === false) continue
    const g = layer.glyphs[char]; if (!g) continue
    const { cellW:lw=15, cellH:lh=15, rows:lr, cols:lc } = layer
    for (let r=0;r<lr;r++) for (let c=0;c<lc;c++) {
      if (!g[r]?.[c]) continue
      const {x,y} = layerGetCellPos(layer,c,r)
      minX=Math.min(minX,x); minY=Math.min(minY,y)
      maxX=Math.max(maxX,x+lw); maxY=Math.max(maxY,y+lh)
    }
  }
  return isFinite(minX) ? { minX, minY, w:maxX-minX, h:maxY-minY } : null
}

function _charGlyphName(char) {
  const MAP = {
    ' ':'space','!':'exclam','"':'quotedbl','#':'numbersign','$':'dollar',
    '%':'percent','&':'ampersand',"'":'quotesingle','(':'parenleft',')':'parenright',
    '*':'asterisk','+':'plus',',':'comma','-':'hyphen','.':'period','/':'slash',
    ':':'colon',';':'semicolon','<':'less','=':'equal','>':'greater','?':'question',
    '@':'at','[':'bracketleft','\\':'backslash',']':'bracketright','^':'asciicircum',
    '_':'underscore','`':'grave','{':'braceleft','|':'bar','}':'braceright','~':'tilde'
  }
  if (MAP[char]) return MAP[char]
  const cp = char.codePointAt(0)
  if ((cp>=65&&cp<=90)||(cp>=97&&cp<=122)) return char
  if (cp>=48&&cp<=57) return `digit${char}`
  return `uni${cp.toString(16).toUpperCase().padStart(4,'0')}`
}

// Render char to an offscreen canvas (white shapes on transparent), including all
// layer effects: skew, smooth, gap, stagger, offset.
// Returns {canvas, w, h} in CSS-pixel units, or null if empty.
function _fontRenderChar(char, RS) {
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity
  for (const layer of pixelState.layers) {
    if (layer.visible === false) continue
    const g = layer.glyphs[char]; if (!g) continue
    const {cellW:lw=15, cellH:lh=15, rows:lr, cols:lc} = layer
    for (let r=0;r<lr;r++) for (let c=0;c<lc;c++) {
      if (!g[r]?.[c]) continue
      const {x,y} = layerGetCellPos(layer,c,r)
      minX=Math.min(minX,x); minY=Math.min(minY,y)
      maxX=Math.max(maxX,x+lw); maxY=Math.max(maxY,y+lh)
    }
  }
  if (!isFinite(minX)) return null
  const cssW = maxX-minX, cssH = maxY-minY
  const PW = Math.ceil(cssW*RS), PH = Math.ceil(cssH*RS)
  const cvs = document.createElement('canvas')
  cvs.width = PW; cvs.height = PH
  const ctx = cvs.getContext('2d')

  for (const layer of [...pixelState.layers].reverse()) {
    if (layer.visible === false) continue
    const g = layer.glyphs[char]; if (!g) continue
    if (!g.some(row=>row?.some(v=>v))) continue
    const {cellW:lw=15, cellH:lh=15, rows:lr, cols:lc,
           smooth:ls=0, skew:lsk=0, shape='rect',
           opacity=1} = layer
    const r2=ls/100, sk=lsk/100

    ctx.save(); ctx.globalAlpha=opacity; ctx.fillStyle='#fff'
    for (let r=0;r<lr;r++) for (let c=0;c<lc;c++) {
      if (!g[r]?.[c]) continue
      const {x,y} = layerGetCellPos(layer,c,r)
      ctx.save()
      ctx.translate((x-minX)*RS, (y-minY)*RS)
      if (sk) ctx.transform(1,0,sk,1,0,0)
      shapePath(ctx, lw*RS, lh*RS, r2, shape)
      ctx.fill(); ctx.restore()
    }
    ctx.restore()
  }
  return { canvas: cvs, cssW, cssH, RS, minY: minY - PIXEL_PAD }
}

// Marching squares: extract closed contour segments from an alpha-channel binary grid.
// Returns segments as [[p1,p2], ...] where p=(gx,gy) in grid space.
function _marchSquares(d, PW, PH, stride, thresh) {
  const GW = Math.ceil(PW/stride)+1, GH = Math.ceil(PH/stride)+1
  const at = (gx,gy) => {
    const px=Math.min(gx*stride,PW-1), py=Math.min(gy*stride,PH-1)
    return d[(py*PW+px)*4+3] > thresh ? 1 : 0
  }
  const segs = []
  for (let gy=0;gy<GH-1;gy++) for (let gx=0;gx<GW-1;gx++) {
    const tl=at(gx,gy),tr=at(gx+1,gy),bl=at(gx,gy+1),br=at(gx+1,gy+1)
    const idx=(tl<<3)|(tr<<2)|(br<<1)|bl
    if (!idx||idx===15) continue
    const T=[gx+.5,gy],R=[gx+1,gy+.5],B=[gx+.5,gy+1],L=[gx,gy+.5]
    switch(idx) {
      case 1:  segs.push([L,B]); break
      case 2:  segs.push([B,R]); break
      case 3:  segs.push([L,R]); break
      case 4:  segs.push([T,R]); break
      case 5:  segs.push([T,R],[L,B]); break   // saddle TR+BL
      case 6:  segs.push([T,B]); break
      case 7:  segs.push([T,L]); break
      case 8:  segs.push([L,T]); break
      case 9:  segs.push([B,T]); break
      case 10: segs.push([L,T],[B,R]); break   // saddle TL+BR
      case 11: segs.push([T,R]); break
      case 12: segs.push([L,R]); break
      case 13: segs.push([R,B]); break
      case 14: segs.push([L,B]); break
    }
  }
  return segs
}

// Stitch unordered segments into closed contours.
// Returns array of point arrays (each contour is a closed polyline).
function _stitchContours(segs) {
  if (!segs.length) return []
  const enc = ([x,y]) => Math.round(x*8)*100000 + Math.round(y*8)
  const adj = new Map()
  const addEnd = (k,i,rev) => { const a=adj.get(k)||[]; a.push({i,rev}); adj.set(k,a) }
  for (let i=0;i<segs.length;i++) {
    addEnd(enc(segs[i][0]),i,false)
    addEnd(enc(segs[i][1]),i,true)
  }
  const used = new Uint8Array(segs.length)
  const out = []
  for (let si=0;si<segs.length;si++) {
    if (used[si]) continue
    used[si]=1
    const contour=[segs[si][0],segs[si][1]]
    const startK=enc(segs[si][0])
    let curK=enc(segs[si][1])
    let lim=segs.length+5
    while(lim-->0 && curK!==startK) {
      const nbrs=adj.get(curK)||[]
      let ok=false
      for (const {i,rev} of nbrs) {
        if (used[i]) continue
        used[i]=1
        const np=rev?segs[i][0]:segs[i][1]
        contour.push(np); curK=enc(np); ok=true; break
      }
      if (!ok) break
    }
    if (contour.length>=3) out.push(contour)
  }
  return out
}

// Trace the rendered canvas and add contour polylines to an opentype Path.
// fontScale: CSS pixels → font units; ASC: ascender in font units.
// originY: CSS y-offset of the bounding box from the grid top (to preserve vertical position).
function _addCanvasContours(path, renderResult, fontScale, ASC, originY = 0) {
  const {canvas, cssW, cssH, RS} = renderResult
  const PW=canvas.width, PH=canvas.height
  const imd = canvas.getContext('2d').getImageData(0,0,PW,PH)
  // Stride: balance resolution vs. performance. At RS≥4, stride=2 gives adequate detail.
  const stride = Math.max(1, Math.round(RS/3))
  const segs = _marchSquares(imd.data, PW, PH, stride, 128)
  const contours = _stitchContours(segs)
  // Marching squares produces CCW contours in canvas space (Y-down).
  // After Y-flip to font space (Y-up), CCW → CW which OTF treats as holes.
  // Reversing makes them CW in canvas → CCW in font → correct outer contours.
  // Hole contours (e.g. inside 'O') come out CW in canvas → CCW in font after
  // reversal → correctly treated as holes by the non-zero winding rule.
  for (const pts of contours) pts.reverse()
  for (const pts of contours) {
    if (pts.length<3) continue
    // Convert grid coords (gx,gy) → font coords (Y-up), offsetting by originY so
    // vertical position within the grid is preserved regardless of bounding-box trimming.
    const toFont = ([gx,gy]) => [
      (gx*stride/RS) * fontScale,
      ASC - ((gy*stride/RS) + originY) * fontScale
    ]
    const [x0,y0]=toFont(pts[0])
    path.moveTo(x0,y0)
    for (let i=1;i<pts.length;i++) { const [x,y]=toFont(pts[i]); path.lineTo(x,y) }
    path.close()
  }
}

// Direct per-cell font path generation — no canvas tracing needed.
// Each filled pixel cell is added as its own shape path directly in font coordinates.
// CW on screen (canvas Y-down) = CCW in font Y-up = correct outer contour for OTF.
function _cellToFontPath(path, cx, cy, w, h, r2, sk, shape, fs, ASC) {
  // fp: local canvas coords within cell → font coords
  const fp = (lx, ly) => [(cx + lx + sk * ly) * fs, ASC - (cy + ly) * fs]
  const rr = r2 * Math.min(w, h) * 0.5  // corner radius in CSS px
  const K = 0.5523  // bezier constant for circular arc approximation

  // Add a polygon (canvas coords) ensuring CW on screen for outer contours
  const addPoly = (pts, hole = false) => {
    let area = 0
    for (let i = 0; i < pts.length; i++) {
      const [x1,y1] = pts[i], [x2,y2] = pts[(i+1) % pts.length]
      area += x1 * y2 - x2 * y1
    }
    // area > 0 → CW on screen; < 0 → CCW on screen
    const ordered = hole ? (area > 0 ? [...pts].reverse() : pts)
                         : (area < 0 ? [...pts].reverse() : pts)
    path.moveTo(...fp(...ordered[0]))
    for (let i = 1; i < ordered.length; i++) path.lineTo(...fp(...ordered[i]))
    path.close()
  }

  switch (shape ?? 'rect') {
    case 'rect': {
      if (rr < 0.5) {
        addPoly([[0,0],[w,0],[w,h],[0,h]])
      } else {
        // Rounded rect, CW on screen: start top-left, go right
        path.moveTo(...fp(rr, 0))
        path.lineTo(...fp(w-rr, 0))
        path.curveTo(...fp(w-rr+rr*K,0), ...fp(w,rr-rr*K), ...fp(w,rr))       // TR corner
        path.lineTo(...fp(w, h-rr))
        path.curveTo(...fp(w,h-rr+rr*K), ...fp(w-rr+rr*K,h), ...fp(w-rr,h))   // BR corner
        path.lineTo(...fp(rr, h))
        path.curveTo(...fp(rr-rr*K,h), ...fp(0,h-rr+rr*K), ...fp(0,h-rr))     // BL corner
        path.lineTo(...fp(0, rr))
        path.curveTo(...fp(0,rr-rr*K), ...fp(rr-rr*K,0), ...fp(rr,0))         // TL corner
        path.close()
      }
      break
    }
    case 'circle': {
      // Ellipse CW on screen: top → right → bottom → left
      const rx = w/2, ry = h/2
      path.moveTo(...fp(w/2, 0))
      path.curveTo(...fp(w/2+rx*K,0),   ...fp(w,ry-ry*K),   ...fp(w,h/2))
      path.curveTo(...fp(w,h/2+ry*K),   ...fp(w/2+rx*K,h),  ...fp(w/2,h))
      path.curveTo(...fp(w/2-rx*K,h),   ...fp(0,h/2+ry*K),  ...fp(0,h/2))
      path.curveTo(...fp(0,h/2-ry*K),   ...fp(w/2-rx*K,0),  ...fp(w/2,0))
      path.close()
      break
    }
    case 'diamond': {
      addPoly([[w/2,0],[w,h/2],[w/2,h],[0,h/2]])
      break
    }
    case 'cross': {
      const ox = w*0.35*(1-r2*0.3), oy = h*0.35*(1-r2*0.3)
      addPoly([[ox,0],[w-ox,0],[w-ox,oy],[w,oy],[w,h-oy],[w-ox,h-oy],[w-ox,h],[ox,h],[ox,h-oy],[0,h-oy],[0,oy],[ox,oy]])
      break
    }
    case 'star4': {
      const ix = w*(0.08+r2*0.40), iy = h*(0.08+r2*0.40)
      const pts = []
      for (let i = 0; i < 8; i++) {
        const a = i*Math.PI/4 - Math.PI/2, outer = i%2===0
        pts.push([w/2 + Math.cos(a)*(outer?w/2:ix), h/2 + Math.sin(a)*(outer?h/2:iy)])
      }
      addPoly(pts)
      break
    }
    case 'star8': {
      const ix = w*(0.2+r2*0.2), iy = h*(0.2+r2*0.2)
      const pts = []
      for (let i = 0; i < 16; i++) {
        const a = i*Math.PI/8 - Math.PI/2, outer = i%2===0
        pts.push([w/2 + Math.cos(a)*(outer?w/2:ix), h/2 + Math.sin(a)*(outer?h/2:iy)])
      }
      addPoly(pts)
      break
    }
    case 'ring': {
      const hs = 0.65 - r2*0.45
      const rx = w/2, ry = h/2, irx = rx*hs, iry = ry*hs
      // Outer ellipse CW on screen
      path.moveTo(...fp(w/2, 0))
      path.curveTo(...fp(w/2+rx*K,0),  ...fp(w,ry-ry*K),  ...fp(w,h/2))
      path.curveTo(...fp(w,h/2+ry*K),  ...fp(w/2+rx*K,h), ...fp(w/2,h))
      path.curveTo(...fp(w/2-rx*K,h),  ...fp(0,h/2+ry*K), ...fp(0,h/2))
      path.curveTo(...fp(0,h/2-ry*K),  ...fp(w/2-rx*K,0), ...fp(w/2,0))
      path.close()
      // Inner hole CCW on screen (= CW in font Y-up = hole)
      path.moveTo(...fp(w/2, h/2-iry))
      path.curveTo(...fp(w/2-irx*K,h/2-iry), ...fp(w/2-irx,h/2-iry*K), ...fp(w/2-irx,h/2))
      path.curveTo(...fp(w/2-irx,h/2+iry*K), ...fp(w/2-irx*K,h/2+iry), ...fp(w/2,h/2+iry))
      path.curveTo(...fp(w/2+irx*K,h/2+iry), ...fp(w/2+irx,h/2+iry*K), ...fp(w/2+irx,h/2))
      path.curveTo(...fp(w/2+irx,h/2-iry*K), ...fp(w/2+irx*K,h/2-iry), ...fp(w/2,h/2-iry))
      path.close()
      break
    }
    case 'heart': {
      const hx = w/2, top = h*0.28
      path.moveTo(...fp(hx, top))
      path.curveTo(...fp(hx,h*0.06), ...fp(w,h*0.06),  ...fp(w,h*0.36))
      path.curveTo(...fp(w,h*0.64),  ...fp(hx,h*0.82), ...fp(hx,h))
      path.curveTo(...fp(hx,h*0.82), ...fp(0,h*0.64),  ...fp(0,h*0.36))
      path.curveTo(...fp(0,h*0.06),  ...fp(hx,h*0.06), ...fp(hx,top))
      path.close()
      break
    }
    default:
      addPoly([[0,0],[w,0],[w,h],[0,h]])
  }
}

async function doFontExport() {
  if (currentMode !== 'pixel') { setStatus('请切换到 Pixel 模式再导出字体'); return }
  const chars = _fexGetChars()
  if (!chars.length) { setStatus('没有可导出的字符'); return }

  if (!window.opentype) {
    setStatus('正在加载字体引擎…')
    try { await loadScript(OPENTYPE_CDN) }
    catch(e) { setStatus('字体引擎加载失败，请检查网络连接'); return }
  }
  if (!window.opentype) { setStatus('字体引擎加载失败'); return }

  setStatus('正在构建字体…')
  const rawName = (document.getElementById('font-export-name').value.trim() || getCurrentDocName())
  const fontName = rawName.replace(/[^\w\s\-]/g, '').trim() || 'MyFont'

  // Scale based on full grid height (including inter-cell gaps, excluding canvas padding)
  const al = pixelActiveLayer()
  const fullCssH = al
    ? (al.rows * (al.cellH ?? 15) + Math.max(0, al.rows - 1) * (al.gapY ?? 1))
    : 100
  const UPM = 1000, ASC = 800, DESC = -200
  const fontScale = fullCssH > 0 ? ASC / fullCssH : 1

  // Build each glyph by iterating filled cells directly
  let totalAdv = 0, nDesigned = 0
  const glyphData = {}

  for (const char of chars) {
    let minX = Infinity, maxX = -Infinity
    let hasPixels = false
    for (const layer of pixelState.layers) {
      if (layer.visible === false) continue
      const g = layer.glyphs[char]; if (!g) continue
      const { cellW: lw = 15, rows: lr, cols: lc } = layer
      for (let r = 0; r < lr; r++) for (let c = 0; c < lc; c++) {
        if (!g[r]?.[c]) continue
        const { x } = layerGetCellPos(layer, c, r)
        minX = Math.min(minX, x); maxX = Math.max(maxX, x + lw)
        hasPixels = true
      }
    }
    if (!hasPixels) continue
    const advW = Math.round((maxX - minX) * fontScale + 50)
    glyphData[char] = { minX, advW }
    totalAdv += advW; nDesigned++
  }

  const defaultAdv = nDesigned > 0 ? Math.round(totalAdv / nDesigned) : 500

  // .notdef: hollow rectangle
  const ndAdv = defaultAdv, nm = 60, nk = 5
  const ndPath = new opentype.Path()
  ndPath.moveTo(nm,nm); ndPath.lineTo(nm,ASC-nm); ndPath.lineTo(ndAdv-nm,ASC-nm); ndPath.lineTo(ndAdv-nm,nm); ndPath.close()
  ndPath.moveTo(nm+nk,nm+nk); ndPath.lineTo(ndAdv-nm-nk,nm+nk); ndPath.lineTo(ndAdv-nm-nk,ASC-nm-nk); ndPath.lineTo(nm+nk,ASC-nm-nk); ndPath.close()

  const glyphs = [new opentype.Glyph({name:'.notdef',unicode:0,advanceWidth:ndAdv,path:ndPath})]

  for (const char of chars) {
    const path = new opentype.Path()
    const gd = glyphData[char]
    if (gd) {
      for (const layer of [...pixelState.layers].reverse()) {
        if (layer.visible === false) continue
        const g = layer.glyphs[char]; if (!g) continue
        const { cellW: lw=15, cellH: lh=15, smooth: ls=0, skew: lsk=0, shape='rect', rows: lr, cols: lc } = layer
        for (let r = 0; r < lr; r++) for (let c = 0; c < lc; c++) {
          if (!g[r]?.[c]) continue
          const { x, y } = layerGetCellPos(layer, c, r)
          _cellToFontPath(path, x - gd.minX, y - PIXEL_PAD, lw, lh, ls/100, lsk/100, shape, fontScale, ASC)
        }
      }
    }
    glyphs.push(new opentype.Glyph({
      name: _charGlyphName(char),
      unicode: char.codePointAt(0),
      advanceWidth: gd?.advW ?? defaultAdv,
      path
    }))
  }

  const font = new opentype.Font({
    familyName: fontName, styleName: 'Regular',
    unitsPerEm: UPM, ascender: ASC, descender: DESC,
    glyphs
  })

  const ext = _fexFmt === 'ttf' ? 'ttf' : 'otf'
  font.download(`${fontName}.${ext}`)
  setStatus(`字体已导出：${chars.length} 个字符`)
  closeFontExportModal()
}

// ─────────────────────────────────────────────
//  CHARACTER GRID
// ─────────────────────────────────────────────
const LATIN_GROUPS = [
  { label:'Uppercase', chars:CHARSET_LATIN.slice(0,26) },
  { label:'Lowercase', chars:CHARSET_LATIN.slice(26,52) },
  { label:'Numbers',   chars:CHARSET_LATIN.slice(52,62) },
  { label:'Symbols',   chars:CHARSET_LATIN.slice(62) },
]
const KOREAN_GROUPS = [
  { label:'기본자음', chars:'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ'.split('') },
  { label:'쌍자음',   chars:'ㄲㄸㅃㅆㅉ'.split('') },
  { label:'겹받침',   chars:'ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ'.split('') },
  { label:'기본모음', chars:'ㅏㅑㅓㅕㅗㅛㅜㅠㅡㅣ'.split('') },
  { label:'복합모음', chars:'ㅐㅒㅔㅖㅘㅙㅚㅝㅞㅟㅢ'.split('') },
]
let activeTab = 'latin'

function makeCharCell(char, idx) {
  const cell = document.createElement('div')
  cell.className = 'char-cell'+(idx===currentCharIdx?' active':'')
  cell.dataset.char = char
  const cnv = document.createElement('canvas'); cell.appendChild(cnv)
  const lbl = document.createElement('span'); lbl.className='char-cell-label'; lbl.textContent=char; cell.appendChild(lbl)
  cell.addEventListener('click', ()=>{
    currentCharIdx = idx
    const disp = document.getElementById('current-char-display')
    if (disp) disp.textContent = char
    if (currentMode==='grid') gridEnsureGlyphSize(); else pixelEnsureGlyphSize()
    resizeCanvas(); renderMainCanvas(null); updateActiveCharCell(); setStatus('Editing: '+char)
  })
  return cell
}

function makeGroupLabel(text, count) {
  const div = document.createElement('div'); div.className='char-group-label'; div.textContent=text
  const span = document.createElement('span'); span.className='char-group-count'; span.textContent=count; div.appendChild(span)
  return div
}

function buildLatinGrid() {
  const grid = document.getElementById('char-grid'); grid.innerHTML=''
  let offset=0
  LATIN_GROUPS.forEach(g=>{ grid.appendChild(makeGroupLabel(g.label,g.chars.length)); g.chars.forEach(ch=>grid.appendChild(makeCharCell(ch,offset++))) })
  setTimeout(()=>renderAllThumbnails(), 0)
}

function buildKoreanGrid() {
  const grid = document.getElementById('char-grid'); grid.innerHTML=''
  let offset=CHARSET_LATIN.length
  KOREAN_GROUPS.forEach(g=>{ grid.appendChild(makeGroupLabel(g.label,g.chars.length)); g.chars.forEach(ch=>grid.appendChild(makeCharCell(ch,offset++))) })
  setTimeout(()=>renderAllThumbnails(), 0)
}

function buildCharGrid() { activeTab==='latin' ? buildLatinGrid() : buildKoreanGrid() }

function switchCharTab(tab) {
  activeTab=tab
  document.getElementById('tab-latin').classList.toggle('active',tab==='latin')
  document.getElementById('tab-korean').classList.toggle('active',tab==='korean')
  buildCharGrid(); updateGlyphCount()
}

// ─────────────────────────────────────────────
//  KEYBOARD
// ─────────────────────────────────────────────
document.addEventListener('keydown', e=>{
  if ((e.ctrlKey||e.metaKey)&&(e.key==='='||e.key==='+')) { e.preventDefault(); zoomIn(); return }
  if ((e.ctrlKey||e.metaKey)&&e.key==='-') { e.preventDefault(); zoomOut(); return }
  if ((e.ctrlKey||e.metaKey)&&e.key==='0') { e.preventDefault(); resetZoom(); return }
  if ((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey) { e.preventDefault(); undo(); return }
  if ((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.key==='z'&&e.shiftKey))) { e.preventDefault(); redo(); return }
  if (e.target.tagName==='INPUT' || e.target.tagName==='TEXTAREA') return
  if (e.key==='Delete'||e.key==='Backspace') { clearGlyph(); return }
})

// ─────────────────────────────────────────────
//  SUBSCRIPTION
// ─────────────────────────────────────────────
function isPro() {
  if (!currentProfile) return false
  if (currentProfile.subscription_status !== 'pro') return false
  const exp = currentProfile.subscription_expires_at
  return !exp || new Date(exp) > new Date()
}

let currentSubTab = 'monthly'

function openSubscriptionModal() {
  closeUserDropdown()
  const modal = document.getElementById('sub-modal')
  if (!modal) return
  modal.classList.add('open')
  renderSubscriptionModal()
}
function closeSubscriptionModal() {
  document.getElementById('sub-modal')?.classList.remove('open')
}

function renderSubscriptionModal() {
  const statusEl    = document.getElementById('sub-current-status')
  const managePanel = document.getElementById('sub-manage-panel')
  const plansPanel  = document.getElementById('sub-plans')
  if (!statusEl) return

  const isExpired = currentProfile?.subscription_status === 'pro' && !isPro()

  if (isPro()) {
    const exp  = new Date(currentProfile.subscription_expires_at)
    const fmt  = exp.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
    const days = Math.max(0, Math.ceil((exp - new Date()) / 86400000))
    const planLabel = currentProfile.subscription_plan === 'yearly' ? 'Pro Yearly' : 'Pro Monthly'
    statusEl.innerHTML = `<span class="sub-badge pro">PRO</span>`
    if (managePanel) managePanel.style.display = 'block'
    if (plansPanel)  plansPanel.style.display  = 'none'
    const daysEl   = document.getElementById('sub-manage-days')
    const planEl   = document.getElementById('sub-manage-plan')
    const expiryEl = document.getElementById('sub-manage-expiry')
    const renewBtn = document.getElementById('sub-renew-btn')
    if (daysEl)   daysEl.textContent   = days
    if (planEl)   planEl.textContent   = planLabel
    if (expiryEl) expiryEl.textContent = fmt
    if (renewBtn) { renewBtn.textContent = 'Renew Now'; renewBtn.className = 'btn primary' }
  } else if (isExpired) {
    const exp  = new Date(currentProfile.subscription_expires_at)
    const fmt  = exp.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
    statusEl.innerHTML = `<span class="sub-badge free">EXPIRED</span>`
    if (managePanel) managePanel.style.display = 'block'
    if (plansPanel)  plansPanel.style.display  = 'none'
    const daysEl   = document.getElementById('sub-manage-days')
    const planEl   = document.getElementById('sub-manage-plan')
    const expiryEl = document.getElementById('sub-manage-expiry')
    if (daysEl)   { daysEl.textContent = '0'; daysEl.style.color = '#e05555' }
    if (planEl)   planEl.textContent   = currentProfile.subscription_plan === 'yearly' ? 'Pro Yearly' : 'Pro Monthly'
    if (expiryEl) expiryEl.textContent = `${fmt} (expired)`
    const renewBtn = document.getElementById('sub-renew-btn')
    if (renewBtn) { renewBtn.textContent = 'Renew Subscription'; renewBtn.className = 'btn primary' }
  } else {
    statusEl.innerHTML = ''
    if (managePanel) managePanel.style.display = 'none'
    if (plansPanel)  plansPanel.style.display  = 'flex'
  }
}

function renewSubscription() {
  const plan = currentProfile?.subscription_plan || 'monthly'
  currentSubTab = plan
  document.querySelectorAll('.sub-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.plan === plan))
  startTossPaymentDirect()
}

async function startTossPaymentDirect() {
  if (!currentUser) { closeSubscriptionModal(); openAuthModal(); return }
  if (!window.TossPayments) {
    setStatus('Loading payment SDK…')
    await loadScript('https://js.tosspayments.com/v1/payment')
  }
  const tossPayments = TossPayments(import.meta.env.VITE_TOSS_CLIENT_KEY)
  const amount    = currentSubTab === 'yearly' ? 50000 : 5000
  const orderId   = `dottypo_${Date.now()}_${currentUser.id.slice(0, 8)}`
  const orderName = currentSubTab === 'yearly' ? 'dottypo Pro Yearly' : 'dottypo Pro Monthly'
  const base      = window.location.origin + window.location.pathname
  tossPayments.requestPayment('카드', {
    amount, orderId, orderName,
    customerEmail: currentUser.email,
    successUrl: `${base}?toss_plan=${currentSubTab}&toss_order=${orderId}`,
    failUrl:    `${base}?toss_fail=1`,
  })
}

function selectPlanTab(plan) {
  currentSubTab = plan
  document.querySelectorAll('.sub-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.plan === plan))
  const priceEl = document.getElementById('sub-pro-price')
  if (priceEl) priceEl.innerHTML = plan === 'yearly' ? '₩50,000<span>/yr</span>' : '₩5,000<span>/mo</span>'
}

async function startTossPayment() {
  if (!currentUser) { closeSubscriptionModal(); openAuthModal(); return }
  if (isPro()) return
  if (!window.TossPayments) {
    setStatus('Loading payment SDK…')
    await loadScript('https://js.tosspayments.com/v1/payment')
  }
  const tossPayments = TossPayments(import.meta.env.VITE_TOSS_CLIENT_KEY)
  const amount    = currentSubTab === 'yearly' ? 50000 : 5000
  const orderId   = `dottypo_${Date.now()}_${currentUser.id.slice(0, 8)}`
  const orderName = currentSubTab === 'yearly' ? 'dottypo Pro Yearly' : 'dottypo Pro Monthly'
  const base      = window.location.origin + window.location.pathname
  tossPayments.requestPayment('카드', {
    amount,
    orderId,
    orderName,
    customerEmail: currentUser.email,
    successUrl: `${base}?toss_plan=${currentSubTab}&toss_order=${orderId}`,
    failUrl:    `${base}?toss_fail=1`,
  })
}

async function handleTossReturn() {
  const params     = new URLSearchParams(window.location.search)
  const paymentKey = params.get('paymentKey')
  const orderId    = params.get('orderId')
  const amount     = params.get('amount')
  const plan       = params.get('toss_plan')
  const fail       = params.get('toss_fail')
  window.history.replaceState({}, '', window.location.pathname)
  if (fail) { setStatus('Payment cancelled'); return }
  if (!paymentKey || !orderId || !amount || !plan || !currentUser) return
  setStatus('Processing payment…')
  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/confirm-billing`,
      {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ paymentKey, orderId, amount: Number(amount), plan, userId: currentUser.id }),
      }
    )
    const raw    = await res.text()
    const result = JSON.parse(raw)
    if (result.success) {
      const p = await fetchProfile(currentUser.id)
      currentProfile = p
      updateAuthUI()
      setStatus('Subscription activated!')
      alert('Subscription activated! 🎉')
    } else {
      const msg = result.error?.message || JSON.stringify(result.error)
      setStatus('Payment failed: ' + msg)
      alert('Payment failed: ' + msg)
    }
  } catch (e) {
    alert('Payment error: ' + e.message)
  }
}

// ─────────────────────────────────────────────
//  AUTH & CLOUD
// ─────────────────────────────────────────────
function updateAuthUI() {
  const btn     = document.getElementById('auth-btn')
  const info    = document.getElementById('user-info')
  const avatarBtn = document.getElementById('user-avatar-btn')
  const dropName  = document.getElementById('dropdown-username')
  const dropEmail = document.getElementById('dropdown-email')
  if (currentUser) {
    if (btn)  btn.style.display = 'none'
    if (info) info.style.display = 'flex'
    const initials = currentProfile?.username
      ? currentProfile.username.slice(0, 2).toUpperCase()
      : currentUser.email.slice(0, 2).toUpperCase()
    if (avatarBtn) avatarBtn.textContent = initials
    if (dropName)  dropName.textContent  = currentProfile?.username || '—'
    if (dropEmail) dropEmail.textContent = currentUser.email
    // plan badge
    const badge = document.getElementById('dropdown-plan-badge')
    if (badge) {
      badge.textContent = isPro() ? 'PRO' : 'FREE'
      badge.className   = isPro() ? 'sub-badge pro' : 'sub-badge free'
    }
    // upgrade vs manage section
    const subSection = document.getElementById('dropdown-sub-section')
    const proSection = document.getElementById('dropdown-pro-section')
    const expiryText = document.getElementById('dropdown-expiry-text')
    if (isPro()) {
      if (subSection) subSection.style.display = 'none'
      if (proSection) proSection.style.display = 'block'
      if (expiryText && currentProfile?.subscription_expires_at) {
        const exp = new Date(currentProfile.subscription_expires_at)
        const fmt = exp.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })
        expiryText.textContent = `Renews ${fmt}`
      }
    } else {
      if (subSection) subSection.style.display = 'block'
      if (proSection) proSection.style.display = 'none'
      // expired but was pro
      if (currentProfile?.subscription_status === 'pro' && expiryText) {
        expiryText.textContent = 'Subscription expired'
        if (proSection) proSection.style.display = 'block'
        if (subSection) subSection.style.display = 'none'
      }
    }
  } else {
    if (btn)  btn.style.display = 'flex'
    if (info) info.style.display = 'none'
    closeUserDropdown()
  }
}

function toggleUserDropdown() {
  const dd = document.getElementById('user-dropdown')
  if (!dd) return
  dd.classList.toggle('open')
}
function closeUserDropdown() {
  const dd = document.getElementById('user-dropdown')
  if (dd) dd.classList.remove('open')
}

async function fetchProfile(userId) {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
  return data || null
}

async function signUp() {
  const username = document.getElementById('auth-username').value.trim()
  const email    = document.getElementById('auth-email').value.trim()
  const pw       = document.getElementById('auth-password').value
  if (!username) return setAuthError('Please enter a username')
  if (!email || !pw) return setAuthError('Please fill in all fields')
  setAuthError(''); setAuthLoading(true)
  const { data, error } = await supabase.auth.signUp({ email, password: pw, options: { data: { username } } })
  setAuthLoading(false)
  if (error) return setAuthError(error.message)
  setAuthError('Account created! You can now log in.', 'ok')
}

async function signIn() {
  let identifier = document.getElementById('auth-email').value.trim()
  const pw       = document.getElementById('auth-password').value
  if (!identifier || !pw) return setAuthError('Please fill in all fields')
  setAuthError(''); setAuthLoading(true)
  let email = identifier
  if (!identifier.includes('@')) {
    try {
      const lookupPromise = supabase.from('profiles').select('email').eq('username', identifier).single()
      const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))
      const { data: prof, error: lookupErr } = await Promise.race([lookupPromise, timeoutPromise])
      if (lookupErr || !prof) { setAuthLoading(false); return setAuthError('Username not found') }
      email = prof.email
    } catch {
      setAuthLoading(false)
      return setAuthError('Username lookup timed out — please use your email instead')
    }
  }
  const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password: pw })
  setAuthLoading(false)
  if (error) return setAuthError(error.message)
  currentUser = signInData.user
  updateAuthUI()
  closeAuthModal()
  fetchProfile(currentUser.id).then(p => { currentProfile = p; updateAuthUI() })
}

async function signOut() {
  clearTimeout(autoSaveTimer)
  autoSaveTimer = null
  await supabase.auth.signOut()
  currentUser = null
  currentProfile = null
  currentCloudDocId = null
  currentDocType = 'font'
  GRID_TYPES.forEach(t => { state.glyphsByType[t] = makeGlyphStore() })
  pixelState.layers = [makePixelLayer()]
  pixelState.activeLayerIdx = 0
  applyDocTypeUI()
  setCurrentDocName('Untitled')
  updateDocHeader()
  resizeCanvas(); renderMainCanvas(null); renderAllThumbnails(); renderPreview()
  closeUserDropdown()
  updateAuthUI()
  setStatus('Signed out')
}

function setAuthError(msg, type = 'err') {
  const el = document.getElementById('auth-error')
  if (!el) return
  el.textContent = msg
  el.style.color = type === 'ok' ? 'var(--accent)' : '#e05555'
}
function setAuthLoading(on) {
  const btn = document.querySelector('#auth-modal .auth-submit-btn')
  if (btn) btn.disabled = on
}

function openAuthModal() {
  document.getElementById('auth-modal').classList.add('open')
  setAuthError('')
}
function closeAuthModal() {
  document.getElementById('auth-modal').classList.remove('open')
}
function switchAuthTab(tab) {
  document.getElementById('auth-tab-login').classList.toggle('active', tab === 'login')
  document.getElementById('auth-tab-register').classList.toggle('active', tab === 'register')
  const usernameField = document.getElementById('auth-username')
  const emailField    = document.getElementById('auth-email')
  const submitBtn     = document.querySelector('#auth-modal .auth-submit-btn')
  if (tab === 'register') {
    if (usernameField) usernameField.style.display = 'block'
    if (emailField) emailField.placeholder = 'Email address'
    if (submitBtn) submitBtn.textContent = 'Create Account'
  } else {
    if (usernameField) usernameField.style.display = 'none'
    if (emailField) emailField.placeholder = 'Email or username'
    if (submitBtn) submitBtn.textContent = 'Login'
  }
  setAuthError('')
}

function handleAuthSubmit() {
  const isRegister = document.getElementById('auth-tab-register')?.classList.contains('active')
  if (isRegister) signUp(); else signIn()
}

// ── Cloud document operations ──
function cloudDocPayload(name) {
  const isGrid = currentMode === 'grid'
  return {
    user_id:    currentUser.id,
    name,
    mode:       currentMode,
    config:     isGrid
      ? { rows:state.rows, cols:state.cols, gutterX:state.gutterX, gutterY:state.gutterY,
          ratio:state.ratio, gridType:state.gridType, cellColor:state.cellColor,
          polar:state.polar, triangular:state.triangular, organic:state.organic,
          previewText: document.getElementById('preview-large-input')?.value || '' }
      : { showGrid: pixelState.showGrid, gridOpacity: pixelState.gridOpacity,
          layers: JSON.parse(JSON.stringify(pixelState.layers)),
          activeLayerIdx: pixelState.activeLayerIdx,
          doc_type: currentDocType,
          previewText: document.getElementById('preview-large-input')?.value || '' },
    glyphs: isGrid ? JSON.parse(JSON.stringify(state.glyphsByType)) : null,
    updated_at: new Date().toISOString()
  }
}

async function cloudSave(name) {
  if (!currentUser) return false
  const payload = cloudDocPayload(name)
  if (currentCloudDocId) {
    const { error } = await supabase.from('documents').update(payload).eq('id', currentCloudDocId)
    return !error
  } else {
    const { data, error } = await supabase.from('documents').insert(payload).select('id').single()
    if (data?.id) currentCloudDocId = data.id
    return !error
  }
}

async function cloudLoad(id) {
  const { data, error } = await supabase.from('documents').select('*').eq('id', id).single()
  if (error || !data) return null
  return data
}

async function cloudDelete(id) {
  await supabase.from('documents').delete().eq('id', id)
}

async function cloudFetchList() {
  if (!currentUser) return []
  const { data } = await supabase.from('documents').select('id,name,mode,config,updated_at')
    .order('updated_at', { ascending: false })
  return data || []
}

// ── Override docsSave / docsLoad / docsDelete / renderDocList ──
const _localDocsSave    = docsSave
const _localDocsLoad    = docsLoad
const _localDocsDelete  = docsDelete
const _localRenderDocList = renderDocList

async function docsSaveCloud(name) {
  setCurrentDocName(name || 'Untitled')
  updateDocHeader()
  setStatus('Saving…')
  const ok = await cloudSave(name || 'Untitled')
  setStatus(ok ? 'Saved · ' + (name||'Untitled') : 'Save failed, please try again')
  await renderDocListCloud()
}

async function docsLoadCloud(id) {
  setStatus('Loading…')
  const doc = await cloudLoad(id)
  if (!doc) return setStatus('Failed to load document')
  currentCloudDocId = doc.id
  currentDocType = doc.config?.doc_type === 'lettering' ? 'lettering' : 'font'
  if (doc.mode !== currentMode) switchMode(doc.mode)
  if (doc.mode === 'grid') {
    Object.assign(state, doc.config)
    migrateGridGlyphs(doc)
    gridSyncSliders(); setGridType(state.gridType)
    const inp = document.getElementById('preview-large-input')
    if (inp && doc.config?.previewText !== undefined) inp.value = doc.config.previewText
  } else {
    migratePixelLoad(doc)
    pixelSyncSliders()
  }
  currentCharIdx = 0
  applyDocTypeUI()
  resizeCanvas(); renderMainCanvas(null); renderAllThumbnails(); renderPreview(); resetZoom()
  updateActiveCharCell()
  setCurrentDocName(doc.name); updateDocHeader()
  setStatus('Loaded: ' + doc.name)
  closeDocManager()
}

async function docsRenameCloud(id, oldName) {
  const item = document.querySelector(`.doc-item[data-id="${id}"]`)
  if (!item) return
  const nameEl = item.querySelector('.doc-name')
  if (!nameEl) return

  const input = document.createElement('input')
  input.value = oldName
  input.className = 'doc-rename-input'
  nameEl.replaceWith(input)
  input.focus(); input.select()

  // Block clicks/mousedown on input from bubbling to doc-info's docsLoadCloud handler
  input.addEventListener('click', e => e.stopPropagation())
  input.addEventListener('mousedown', e => e.stopPropagation())

  let done = false
  const restore = () => {
    if (done) return; done = true
    input.replaceWith(Object.assign(document.createElement('div'), { className: 'doc-name', textContent: oldName }))
  }
  const commit = async () => {
    if (done) return; done = true
    const newName = input.value.trim() || oldName
    input.replaceWith(Object.assign(document.createElement('div'), { className: 'doc-name', textContent: newName }))
    if (newName !== oldName) {
      await supabase.from('documents').update({ name: newName }).eq('id', id)
      if (id === currentCloudDocId) { setCurrentDocName(newName); updateDocHeader() }
      renderDocListCloud()
    }
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    if (e.key === 'Escape') { restore() }
  })
  input.addEventListener('blur', () => setTimeout(commit, 120))
}

async function docsDeleteCloud(id) {
  if (!confirm('Delete this document?')) return
  if (id === currentCloudDocId) { currentCloudDocId = null; setCurrentDocName('Untitled'); updateDocHeader() }
  await cloudDelete(id)
  await renderDocListCloud()
  setStatus('Document deleted')
}

async function renderDocListCloud() {
  const list = document.getElementById('doc-list'); if (!list) return
  const docs = await cloudFetchList()
  if (!docs.length) {
    list.innerHTML = `<div class="doc-empty">No saved documents yet. Enter a name above and click Save.</div>`
    return
  }
  list.innerHTML = docs.map(d => `
    <div class="doc-item${d.id === currentCloudDocId ? ' active' : ''}" data-id="${d.id}">
      <div class="doc-info" onclick="docsLoadCloud('${d.id}')">
        <div class="doc-name">${d.name}</div>
        <div class="doc-meta"><span class="doc-mode-tag">${d.config?.doc_type === 'lettering' ? 'LETTERING' : d.mode.toUpperCase()}</span>${new Date(d.updated_at).toLocaleString()}</div>
      </div>
      <div class="doc-actions">
        <button class="doc-action-btn" onclick="event.stopPropagation();docsRenameCloud('${d.id}','${d.name.replace(/'/g,"\\'")}' )" title="Rename">✎</button>
        <button class="doc-action-btn del" onclick="docsDeleteCloud('${d.id}')" title="Delete">✕</button>
      </div>
    </div>`).join('')
}

// Patch: override save/load/renderDocList when user is logged in
function patchedDocsSave(name) {
  if (currentUser) return docsSaveCloud(name)
  return _localDocsSave(name)
}
function patchedDocsLoad(id) {
  if (currentUser) return docsLoadCloud(id)
  return _localDocsLoad(id)
}
function patchedDocsDelete(id) {
  if (currentUser) return docsDeleteCloud(id)
  return _localDocsDelete(id)
}
function patchedRenderDocList() {
  if (currentUser) return renderDocListCloud()
  return _localRenderDocList()
}

let _newFilePendingMode = 'grid'
let _newFilePendingType = 'font'

function openNewFileModal() {
  if (!currentUser) { openAuthModal(); return }
  _newFilePendingMode = currentMode
  _newFilePendingType = 'font'
  document.querySelectorAll('.nf-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === _newFilePendingMode))
  document.getElementById('nf-type-font')?.classList.add('active')
  document.getElementById('nf-type-lettering')?.classList.remove('active')
  const gridBtn = document.querySelector('.nf-mode-btn[data-mode="grid"]')
  if (gridBtn) { gridBtn.disabled = false; gridBtn.style.opacity = ''; gridBtn.style.cursor = '' }
  document.getElementById('new-file-name').value = ''
  document.getElementById('new-file-modal').style.display = 'flex'
  setTimeout(() => document.getElementById('new-file-name').focus(), 50)
}

function closeNewFileModal() {
  document.getElementById('new-file-modal').style.display = 'none'
}

function setNewFileMode(mode) {
  _newFilePendingMode = mode
  document.querySelectorAll('.nf-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode))
}

function setNewFileType(type) {
  _newFilePendingType = type
  const fontBtn = document.getElementById('nf-type-font')
  const letBtn  = document.getElementById('nf-type-lettering')
  if (fontBtn)  { fontBtn.classList[type === 'font' ? 'add' : 'remove']('active') }
  if (letBtn)   { letBtn.classList[type === 'lettering' ? 'add' : 'remove']('active') }
  const gridBtn = document.querySelector('.nf-mode-btn[data-mode="grid"]')
  if (gridBtn) {
    gridBtn.disabled = type === 'lettering'
    gridBtn.style.opacity = type === 'lettering' ? '0.35' : ''
    gridBtn.style.cursor = type === 'lettering' ? 'not-allowed' : ''
  }
  if (type === 'lettering') {
    _newFilePendingMode = 'pixel'
    document.querySelectorAll('#nf-mode-section .nf-mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === 'pixel'))
  }
}

async function confirmNewFile() {
  const name = document.getElementById('new-file-name').value.trim() || 'Untitled'
  closeNewFileModal()
  if (!currentUser) return
  if (!isPro()) {
    const existing = await cloudFetchList()
    if (existing.length >= 5) { openSubscriptionModal(); setStatus('Free plan: 5 file limit reached'); return }
  }
  if (_newFilePendingMode !== currentMode) switchMode(_newFilePendingMode)
  currentDocType = _newFilePendingType
  currentCloudDocId = null
  if (_newFilePendingMode === 'pixel') {
    pixelState.layers = [makePixelLayer()]
    pixelState.activeLayerIdx = 0
    renderLayerList(); pixelSyncSliders()
  } else {
    GRID_TYPES.forEach(t => { state.glyphsByType[t] = makeGlyphStore() })
  }
  currentCharIdx = 0
  applyDocTypeUI()
  updateActiveCharCell()
  resizeCanvas(); renderMainCanvas(null); renderAllThumbnails(); renderPreview(); resetZoom()
  docsSaveCloud(name)
}

async function saveNewDocPatched() {
  const inp = document.getElementById('doc-name-input')
  const name = inp.value.trim() || 'Untitled'
  inp.value = ''
  if (currentUser) {
    if (!isPro()) {
      const existing = await cloudFetchList()
      if (existing.length >= 5) {
        openSubscriptionModal()
        setStatus('Free plan: 5 file limit reached')
        return
      }
    }
    // Always create a brand-new document (never overwrite the active one)
    currentCloudDocId = null
    if (currentMode === 'pixel') {
      pixelState.layers = [makePixelLayer()]
      pixelState.activeLayerIdx = 0
      renderLayerList()
    } else {
      GRID_TYPES.forEach(t => { state.glyphsByType[t] = makeGlyphStore() })
    }
    currentCharIdx = 0
    updateActiveCharCell()
    resizeCanvas(); renderMainCanvas(null); renderAllThumbnails(); renderPreview(); resetZoom()
    docsSaveCloud(name)
  } else {
    _localDocsSave(name)
    closeDocManager()
  }
}

function openDocManagerPatched() {
  document.getElementById('doc-manager').classList.add('open')
  patchedRenderDocList()
}

// ── Landing page ──
function hideLanding() {
  const el = document.getElementById('landing')
  if (el) { el.classList.remove('visible'); el.classList.add('hidden') }
  stopLogoAnim()
}
function showLanding() {
  const el = document.getElementById('landing')
  if (el) { el.classList.remove('hidden'); el.classList.add('visible') }
  setTimeout(startLandingAnims, 300)
  document.fonts.ready.then(() => initLogoAnim())
}

// ── Logo pixel animation ──
let _logoRaf = null

function stopLogoAnim() {
  if (_logoRaf) { cancelAnimationFrame(_logoRaf); _logoRaf = null }
}

function initLogoAnim() {
  stopLogoAnim()
  const canvas = document.getElementById('logo-canvas')
  const fallback = document.getElementById('logo-fallback')
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const DPR = Math.min(window.devicePixelRatio || 1, 3)

  // ── Step 1: rasterize 'dottypo' into pixel positions ──
  const FONT_PX = 234
  const GRID_B  = 14   // single grid — all steps share same dot positions (no jump)

  const off = document.createElement('canvas')
  off.width = 2400; off.height = 340
  const oc = off.getContext('2d')
  oc.font = `700 ${FONT_PX}px "DM Sans", sans-serif`
  oc.textBaseline = 'top'

  // x boundary between 'dot' and 'typo' (in off-canvas coords)
  const DOT_END = 4 + oc.measureText('dot').width

  oc.clearRect(0, 0, off.width, off.height)
  oc.fillStyle = '#fff'
  oc.fillText('dottypo', 4, 20)
  const imd = oc.getImageData(0, 0, off.width, off.height)
  const d = imd.data
  const baseS = { dot: [], typo: [] }
  for (let y = 0; y < off.height; y += GRID_B) {
    for (let x = 0; x < off.width; x += GRID_B) {
      const i = (y * off.width + x) * 4
      if (d[i + 3] > 55) {
        if (x < DOT_END) baseS.dot.push([x, y])
        else baseS.typo.push([x, y])
      }
    }
  }

  const allBase = [...baseS.dot, ...baseS.typo]
  if (!allBase.length) return

  // canvas size
  const bxs = allBase.map(p => p[0]), bys = allBase.map(p => p[1])
  const minX = Math.min(...bxs), maxX = Math.max(...bxs)
  const minY = Math.min(...bys), maxY = Math.max(...bys)
  const pad  = 18
  const cssW = maxX - minX + GRID_B + pad * 2
  const cssH = maxY - minY + GRID_B + pad * 2

  canvas.width  = cssW * DPR
  canvas.height = cssH * DPR
  canvas.style.width  = cssW + 'px'
  canvas.style.height = cssH + 'px'
  ctx.scale(DPR, DPR)

  // show canvas, hide text fallback
  canvas.style.opacity = '1'
  if (fallback) fallback.style.display = 'none'

  // dot = fluorescent green, typo = white
  const C_DOT  = '#9dff6a'
  const C_TYPO = '#ffffff'

  // ── Step 2: animation loop ──
  const STEPS = [
    { shape: 'rect',    sw: 0.75, sh: 0.75, skew:  0.00 },  // compact squares
    { shape: 'circle',  sw: 1.42, sh: 1.42, skew:  0.00 },  // large overlapping circles → bold filled look
    { shape: 'diamond', sw: 0.60, sh: 0.60, skew:  0.00 },  // sparse diamonds → lots of space
    { shape: 'cross',   sw: 0.85, sh: 0.85, skew: -0.42 },  // skewed
    { shape: 'star4',   sw: 2.00, sh: 0.36, skew:  0.00 },  // very wide flat → horizontal stripe effect
    { shape: 'heart',   sw: 0.90, sh: 1.10, skew:  0.00 },  // tall hearts → text stretched 110% vertically
  ]
  const CYCLE     = 2083
  const BLEND_AT  = 0.72
  const SIZE_BASE = GRID_B * 0.9

  const lerp = (a, b, t) => a + (b - a) * t
  const ease = t => 0.5 * (1 - Math.cos(t * Math.PI))

  // draw all glyphs in a given shape/size at a given opacity
  function drawGlyphs(shape, szW, szH, alpha) {
    ctx.globalAlpha = alpha
    for (const [color, pts] of [[C_DOT, baseS.dot], [C_TYPO, baseS.typo]]) {
      ctx.fillStyle = color
      for (const [px, py] of pts) {
        const cx = px - minX + pad + GRID_B / 2
        const cy = py - minY + pad + GRID_B / 2
        ctx.save()
        ctx.translate(cx - szW / 2, cy - szH / 2)
        shapePath(ctx, szW, szH, 0.15, shape)
        ctx.fill()
        ctx.restore()
      }
    }
    ctx.globalAlpha = 1
  }

  let _start = null

  function frame(ts) {
    if (!_start) _start = ts
    const t = ts - _start

    const si    = Math.floor(t / CYCLE) % STEPS.length
    const phase = (t % CYCLE) / CYCLE
    const from  = STEPS[si]
    const to    = STEPS[(si + 1) % STEPS.length]

    const blend    = phase < BLEND_AT ? 0 : ease((phase - BLEND_AT) / (1 - BLEND_AT))
    const curSW    = lerp(from.sw,   to.sw,   blend) * SIZE_BASE
    const curSH    = lerp(from.sh,   to.sh,   blend) * SIZE_BASE
    const curSkew  = lerp(from.skew, to.skew, blend)

    // gentle breathing
    const breath = 0.92 + 0.08 * Math.sin(t * 0.00175 * Math.PI)
    const szW = curSW * breath
    const szH = curSH * breath

    ctx.clearRect(0, 0, cssW, cssH)
    ctx.save()

    if (curSkew !== 0) {
      ctx.transform(1, 0, curSkew, 1, -cssH / 2 * curSkew, 0)
    }

    if (blend === 0) {
      // static phase: single full-opacity draw
      drawGlyphs(from.shape, szW, szH, 1)
    } else {
      // cross-fade: old shape fades out, new shape fades in, sizes lerp together
      drawGlyphs(from.shape, szW, szH, 1 - blend)
      drawGlyphs(to.shape,   szW, szH, blend)
    }

    ctx.restore()

    _logoRaf = requestAnimationFrame(frame)
  }

  _logoRaf = requestAnimationFrame(frame)
}

// ── Landing step animations ──
let _landingAnimsStarted = false
function startLandingAnims() {
  if (_landingAnimsStarted) return
  _landingAnimsStarted = true

  // ── Anim 1: shape picker cycling ──
  const shapeOpts = document.querySelectorAll('#sa-shapes .sa-shape-opt')
  if (shapeOpts.length) {
    let si = 0
    shapeOpts[si].classList.add('sa-active')
    setInterval(() => {
      shapeOpts[si].classList.remove('sa-active')
      si = (si + 1) % shapeOpts.length
      shapeOpts[si].classList.add('sa-active')
    }, 900)
  }

  // ── Anim 2: sliders moving ──
  const handles = [
    document.getElementById('sa-h0'),
    document.getElementById('sa-h1'),
    document.getElementById('sa-h2'),
  ]
  // preset positions (% left) for each slider across 3 keyframes
  const presets = [
    [20, 65, 40],
    [55, 25, 72],
    [38, 80, 18],
  ]
  if (handles.every(Boolean)) {
    let kf = 0
    function stepSliders() {
      handles.forEach((h, i) => { h.style.left = presets[kf][i] + '%' })
      kf = (kf + 1) % presets.length
    }
    stepSliders()
    setInterval(stepSliders, 1100)
  }

  // ── Anim 2: pixel grid draws letter 'd' ──
  // 5×5 grid, indices 0-24 row-major
  // d:  .####   row0: 1,2,3
  //     #...#   row1: 0,4
  //     #...#   row2: 0,4 (← wait, 'd' reversed)
  // Let's draw a simple "o" shape
  const O_SHAPE = [1,2,3, 5,9, 10,14, 15,19, 21,22,23]
  const pixels = document.querySelectorAll('#sa-draw .sa-pix')
  if (pixels.length) {
    let step = 0
    function drawTick() {
      if (step < O_SHAPE.length) {
        pixels[O_SHAPE[step]].classList.add('sa-lit')
        step++
        setTimeout(drawTick, 90)
      } else {
        setTimeout(() => {
          pixels.forEach(p => p.classList.remove('sa-lit'))
          step = 0
          setTimeout(drawTick, 500)
        }, 1400)
      }
    }
    setTimeout(drawTick, 600)
  }

  // ── Anim 3: live preview text cycling ──
  const previewText = document.getElementById('sa-preview-text')
  if (previewText) {
    const samples = ['Aa', 'Bb Cc', 'Hello', '01 02', 'Zz']
    let pi = 0
    function cyclePrev() {
      previewText.style.opacity = '0'
      setTimeout(() => {
        pi = (pi + 1) % samples.length
        previewText.textContent = samples[pi]
        previewText.style.opacity = '1'
      }, 300)
    }
    setInterval(cyclePrev, 1800)
  }

  // ── Anim 4: export format cycling with progress bar ──
  const fmts = document.querySelectorAll('#sa-export .sa-fmt')
  const bar = document.getElementById('sa-bar')
  if (fmts.length && bar) {
    let fi = 0
    function runFmt() {
      fmts.forEach(f => f.classList.remove('sa-active'))
      fmts[fi].classList.add('sa-active')
      bar.style.transition = 'none'
      bar.style.width = '0%'
      requestAnimationFrame(() => requestAnimationFrame(() => {
        bar.style.transition = 'width 1.1s cubic-bezier(0.4,0,0.6,1)'
        bar.style.width = '100%'
      }))
      setTimeout(() => {
        fi = (fi + 1) % fmts.length
        setTimeout(runFmt, 200)
      }, 1400)
    }
    setTimeout(runFmt, 900)
  }
}

// ── Help drawer ──
let _helpOpen = false
function toggleHelp() {
  _helpOpen = !_helpOpen
  document.getElementById('help-drawer')?.classList.toggle('open', _helpOpen)
  document.getElementById('help-backdrop')?.classList.toggle('open', _helpOpen)
  document.getElementById('help-btn')?.classList.toggle('active', _helpOpen)
}

// ── Init Supabase auth listener ──
let _authReady = false
function initAuth() {
  supabase.auth.getSession().then(({ data: { session } }) => {
    currentUser = session?.user || null
    updateAuthUI()
    _authReady = true
    // 无论是否登录，始终先显示 landing，用户点击 Start designing 才进入
    showLanding()
    if (currentUser) {
      const hasTossReturn = new URLSearchParams(window.location.search).get('paymentKey')
      fetchProfile(currentUser.id).then(p => { currentProfile = p; updateAuthUI() })
      if (hasTossReturn) {
        // 支付回调页面直接跳过 landing
        hideLanding()
        handleTossReturn()
      }
    }
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    const wasLoggedOut = !currentUser
    currentUser = session?.user || null
    updateAuthUI()
    if (currentUser) {
      const landingVisible = document.getElementById('landing')?.classList.contains('visible')
      if (!landingVisible) {
        hideLanding()  // already inside editor — no landing to hide
      }
      // If landing is visible: stay on landing; user clicks "Start designing" to enter
      fetchProfile(currentUser.id).then(p => {
        currentProfile = p
        updateAuthUI()
        setStatus('Signed in as ' + (p?.username || currentUser.email))
      })
      if (_authReady && wasLoggedOut && !landingVisible) {
        setTimeout(() => openDocManagerPatched(), 400)
      }
    } else {
      currentProfile = null
    }
  })
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('#user-info')) closeUserDropdown()
})

// ─────────────────────────────────────────────
//  INIT
function init() {
  // Debug: log full URL on every load
  const _dbgParams = new URLSearchParams(window.location.search)
  console.log('[init] URL params:', window.location.search || '(none)')
  console.log('[init] authKey:', _dbgParams.get('authKey'), '| toss_plan:', _dbgParams.get('toss_plan'))
  buildCharGrid()
  document.getElementById('theme-toggle').innerHTML = SVG_MOON
  initAuth()
  setTimeout(() => {
    switchMode(currentMode)   // 初始化默认模式（pixel-mode class、sliders、layer list 等）
    resetZoom()
    renderAllThumbnails(); renderPreview()
    setStatus('Log in to save your work')
  }, 50)
  // start logo animation (landing is visible on first load)
  document.fonts.ready.then(() => initLogoAnim())
}

// ─────────────────────────────────────────────
//  FULL PREVIEW
// ─────────────────────────────────────────────
let previewOpen = false
let previewAlign = 'left'

function setPreviewAlign(align) {
  previewAlign = align
  ;['left','center','right'].forEach(a => {
    const btn = document.getElementById('preview-align-'+a)
    if (btn) btn.classList.toggle('active', a === align)
  })
  renderLargePreview()
}

function _syncPreviewBtns() {
  const btnPreview = document.getElementById('btn-preview')
  const btnDesign  = document.getElementById('btn-design')
  if (btnPreview) btnPreview.classList.toggle('active', previewOpen)
  if (btnDesign)  btnDesign.classList.toggle('active', !previewOpen)
}

function showPreview() {
  if (previewOpen) return
  previewOpen = true
  const overlay = document.getElementById('preview-overlay')
  if (!overlay) return
  overlay.style.display = 'flex'
  _syncPreviewBtns()
  setTimeout(() => {
    const inp = document.getElementById('preview-large-input')
    if (inp) inp.focus()
    renderLargePreview()
  }, 20)
}

function showDesign() {
  if (!previewOpen) return
  previewOpen = false
  const overlay = document.getElementById('preview-overlay')
  if (overlay) overlay.style.display = 'none'
  _syncPreviewBtns()
}

function togglePreview() {
  if (previewOpen) { showDesign() } else { showPreview() }
}

function renderLargePreview() {
  if (!previewOpen) return
  const inp = document.getElementById('preview-large-input')
  const pc = document.getElementById('preview-large-canvas')
  if (!inp || !pc) return
  // auto-resize textarea
  inp.style.height = 'auto'; inp.style.height = inp.scrollHeight + 'px'
  const text = inp.value || ''
  const targetH  = parseInt(document.getElementById('preview-size-slider')?.value  || 120)
  const lineHPct = parseInt(document.getElementById('preview-lineh-slider')?.value || 130)
  const lspc     = parseInt(document.getElementById('preview-lspc-slider')?.value  || 0)
  const hint = document.getElementById('preview-empty-hint')
  if (hint) hint.style.opacity = text.length ? '0' : '1'
  const sizeVal  = document.getElementById('preview-size-val');  if (sizeVal)  sizeVal.textContent  = targetH
  const linehVal = document.getElementById('preview-lineh-val'); if (linehVal) linehVal.textContent = lineHPct
  const lspcVal  = document.getElementById('preview-lspc-val');  if (lspcVal)  lspcVal.textContent  = lspc
  if (currentMode === 'grid') {
    renderLargePreviewGrid(text, pc, targetH, lineHPct, lspc)
  } else {
    renderLargePreviewPixel(text, pc, targetH, lineHPct, lspc)
  }
}

function renderLargePreviewGrid(text, pc, targetH, lineHPct = 130, lspc = 0) {
  const lines = text.split('\n')
  const lw = GRID_LOGICAL_W(), lh = GRID_LOGICAL_H()
  const scale = targetH / Math.max(1, lh)
  const charW = lw * scale
  const extra = (lspc / 100) * targetH
  const lineH = targetH * (lineHPct / 100)
  const totalH = lines.length === 1 ? targetH : (lines.length - 1) * lineH + targetH
  const maxLineW = Math.max(4, ...lines.map(l => l.length * (charW + extra)))
  const dpr = window.devicePixelRatio || 1
  pc.width = maxLineW * dpr; pc.height = totalH * dpr
  pc.style.width = maxLineW + 'px'; pc.style.height = totalH + 'px'
  const c2 = pc.getContext('2d')
  c2.scale(dpr, dpr); c2.clearRect(0, 0, maxLineW, totalH)
  c2.fillStyle = state.cellColor
  lines.forEach((line, li) => {
    const yOff = li * lineH
    const lineW = line.length * (charW + extra)
    const startX = previewAlign === 'right' ? maxLineW - lineW
                 : previewAlign === 'center' ? (maxLineW - lineW) / 2
                 : 0
    for (let ci = 0; ci < line.length; ci++) {
      const glyph = gridGlyphs()[line[ci]]; if (!glyph) continue
      c2.save(); c2.translate(startX + ci * (charW + extra), yOff); c2.scale(scale, scale)
      for (const { r, c, path } of gridPaths) { if (glyph[r]?.[c]) c2.fill(path) }
      c2.restore()
    }
  })
}

function renderLargePreviewPixel(text, pc, targetH, lineHPct = 130, lspc = 0) {
  if (!text) {
    pc.width = 4; pc.height = targetH; pc.style.width = '4px'; pc.style.height = targetH + 'px'
    return
  }
  const RS = 2
  const al = pixelActiveLayer()
  const fullCssH = al ? (al.rows * (al.cellH ?? 15)) : 100
  const blankCssW = al ? (al.cols * (al.cellW ?? 15)) : 60
  const lines = text.split('\n')
  // render all unique chars once
  const uniqueChars = [...new Set(text.replace(/\n/g, ''))]
  const charMap = new Map(uniqueChars.map(ch => [ch, pixelRenderCharToCanvas(ch, RS)]))
  // Scale based on full grid height so each character keeps its designed proportions
  const cssScale = targetH / fullCssH
  const extra = (lspc / 100) * targetH
  const lineH = targetH * (lineHPct / 100)
  const totalH = lines.length === 1 ? targetH : (lines.length - 1) * lineH + targetH
  const lineWidths = lines.map(line =>
    [...line].reduce((s, ch, i) => {
      const r = charMap.get(ch)
      return s + (r ? r.cssW * cssScale : blankCssW * cssScale) + (i > 0 ? extra : 0)
    }, 0))
  const totalW = Math.max(4, ...lineWidths)
  const dpr = window.devicePixelRatio || 1
  pc.width = totalW * dpr; pc.height = totalH * dpr
  pc.style.width = totalW + 'px'; pc.style.height = totalH + 'px'
  const c2 = pc.getContext('2d')
  c2.scale(dpr, dpr); c2.clearRect(0, 0, totalW, totalH)
  c2.imageSmoothingEnabled = true; c2.imageSmoothingQuality = 'high'
  lines.forEach((line, li) => {
    if (!line) return
    const yOff = li * lineH
    let x = previewAlign === 'right' ? totalW - lineWidths[li]
          : previewAlign === 'center' ? (totalW - lineWidths[li]) / 2
          : 0
    ;[...line].forEach((ch, i) => {
      const r = charMap.get(ch)
      if (r) {
        const dw = r.cssW * cssScale, dh = r.cssH * cssScale
        const yTopOffset = r.minY * cssScale
        c2.drawImage(r.canvas, x, yOff + yTopOffset, dw, dh)
        x += dw
      } else {
        x += blankCssW * cssScale
      }
      if (i < line.length - 1) x += extra
    })
  })
}

// Re-apply zoom on resize so fit-to-view stays correct for both modes
window.addEventListener('resize', () => {
  if (currentMode === 'grid') {
    gridResizeCanvas(); gridRenderMainCanvas(hoveredCell)
  }
  applyZoom()
})

// ─────────────────────────────────────────────
//  TOUR COACHMARK
// ─────────────────────────────────────────────
const TOUR_STEPS = [
  {
    target: '#auth-btn',
    fallback: '#user-avatar-btn',
    num: '01 / 08',
    text: 'Sign up or log in to save your work — your fonts are stored to your account.'
  },
  {
    target: 'button[onclick="openNewFileModal()"]',
    num: '02 / 08',
    text: 'Create a new file to get started — each file is one font project.'
  },
  {
    target: '.left-panel-tabs',
    targetEnd: '.pixel-shape-grid',
    num: '03 / 08',
    text: 'Choose a cell shape — the building block of every character in your font.'
  },
  {
    target: '.param-panel',
    fallback: '.panel-section',
    num: '04 / 08',
    text: 'Set grid size and effects — these apply to all characters globally.'
  },
  {
    target: '.char-grid-header',
    targetEnd: '#char-grid',
    num: '05 / 08',
    text: 'Pick a character from the grid on the right to start designing.'
  },
  {
    target: '#canvas-wrapper',
    num: '06 / 08',
    text: 'Left-click to draw · Right-click to erase.'
  },
  {
    target: '#btn-preview',
    num: '07 / 08',
    text: 'Switch to Preview to type freely and see your font as real text.'
  },
  {
    target: '#export-btns',
    num: '08 / 08',
    text: 'Export — SVG · PNG for single glyphs, Font ↓ for a full OTF / TTF file.'
  }
]

let _tourStep = 0

function startTour() {
  _tourStep = 0
  document.getElementById('tour-overlay').style.display = 'block'
  document.getElementById('tour-trigger-btn')?.classList.add('tour-active')
  _tourRender()
}

function closeTour() {
  document.getElementById('tour-overlay').style.display = 'none'
  document.getElementById('tour-trigger-btn')?.classList.remove('tour-active')
}

function tourNext() {
  _tourStep++
  if (_tourStep >= TOUR_STEPS.length) { closeTour(); return }
  _tourRender()
}

function _tourRender() {
  const step = TOUR_STEPS[_tourStep]
  const isLast = _tourStep === TOUR_STEPS.length - 1

  // find target element — skip hidden elements (display:none)
  const isVisible = e => e && e.offsetParent !== null && e.offsetWidth > 0
  let el = document.querySelector(step.target)
  if (!isVisible(el)) el = null
  if (!el && step.fallback) {
    const fb = document.querySelector(step.fallback)
    if (isVisible(fb)) el = fb
  }
  if (!el) { tourNext(); return }

  let rect = el.getBoundingClientRect()
  // expand rect to cover a second element if specified
  if (step.targetEnd) {
    const el2 = document.querySelector(step.targetEnd)
    if (el2) {
      const r2 = el2.getBoundingClientRect()
      rect = {
        left:   Math.min(rect.left,   r2.left),
        top:    Math.min(rect.top,    r2.top),
        right:  Math.max(rect.right,  r2.right),
        bottom: Math.max(rect.bottom, r2.bottom),
        width:  0, height: 0
      }
      rect.width  = rect.right  - rect.left
      rect.height = rect.bottom - rect.top
    }
  }
  const pad = 6

  // position highlight
  const hl = document.getElementById('tour-highlight')
  hl.style.left   = (rect.left - pad) + 'px'
  hl.style.top    = (rect.top  - pad) + 'px'
  hl.style.width  = (rect.width  + pad * 2) + 'px'
  hl.style.height = (rect.height + pad * 2) + 'px'

  // update card text
  document.getElementById('tour-step-num').textContent = step.num
  document.getElementById('tour-text').textContent = step.text
  document.getElementById('tour-next').textContent = isLast ? 'Done ✓' : 'Next →'

  // position card: right-side elements → card to the left; else below → above fallback
  const card = document.getElementById('tour-card')
  const cardH = 140, cardW = 280, margin = 14
  const inRightHalf = rect.left + rect.width / 2 > window.innerWidth / 2

  let top, left
  if (inRightHalf) {
    // place card to the LEFT of the highlight
    left = rect.left - pad - margin - cardW
    top  = rect.top + pad
    if (left < 8) left = 8
    if (top + cardH > window.innerHeight) top = window.innerHeight - cardH - 8
  } else {
    // place card BELOW, fall back ABOVE
    top  = rect.bottom + pad + margin
    left = rect.left + pad
    if (top + cardH > window.innerHeight) top = rect.top - pad - margin - cardH
    if (top < 8) top = 8
  }
  if (left + cardW > window.innerWidth) left = window.innerWidth - cardW - 16
  if (left < 8) left = 8
  card.style.top  = top  + 'px'
  card.style.left = left + 'px'
}

Object.assign(window, {
  updateParam, setGridType, updateColor, updateGridSpecificParam,
  updatePixelParam, setPixelType, updatePixelColor,
  toggleGrid, clearGlyph, randomizeGlyph,
  prevChar, nextChar, handleLoadFile,
  downloadSVG, downloadPNG, openFontExportModal, closeFontExportModal, selectFontOpt, doFontExport,
  zoomIn, zoomOut, resetZoom,
  toggleTheme, renderPreview, switchCharTab, switchMode,
  togglePreview, showPreview, showDesign, renderLargePreview, setPreviewAlign,
  openDocManager: openDocManagerPatched,
  closeDocManager, docsLoad: patchedDocsLoad, docsDelete: patchedDocsDelete,
  docsDeleteCloud, docsLoadCloud,
  docsRename, docsRenameCloud, saveNewDoc: saveNewDocPatched,
  createNewDoc, saveCurrentDoc,
  toggleGuidePanel, toggleGuideLines, addGuideLine, removeGuideLine, updateGuideLine,
  openNewFileModal, closeNewFileModal, setNewFileMode, setNewFileType, confirmNewFile,
  hideLanding, showLanding, toggleHelp,
  startTour, closeTour, tourNext,
  openAuthModal, closeAuthModal, switchAuthTab, handleAuthSubmit, signIn, signUp, signOut, toggleUserDropdown,
  openSubscriptionModal, closeSubscriptionModal, selectPlanTab, startTossPayment, renewSubscription,
  addPixelLayer, duplicatePixelLayer, removePixelLayer, setActiveLayer, setLayerOpacity, setLayerName,
  toggleLayerVisible, moveLayerUp, moveLayerDown,
  undo, redo, updateGridOpacity, gridOpacityDown, gridOpacityUp
})

init()
