import pdfParse from "pdf-parse"

export type ParsedIndentItem = {
  srNo: number
  ksbclItemCode: string
  ksbclBaseCode: string
  ksbclSubCode: string
  itemName: string
  rawItemName: string
  sizeMl: number
  bottlesPerCase: number
  ratePerCase: number
  indentCases: number
  indentBottles: number
  indentAmount: number
  cnfCases: number
  cnfBottles: number
  cnfAmount: number
  isRationed: boolean
  isNotAllocated: boolean
}

export type ParsedIndent = {
  indentNumber: string
  invoiceNumber: string
  retailerId: string
  retailerName: string
  indentDate: string
  totalRationedItems: number
  totalIndentValue: number
  totalConfirmedValue: number
  items: ParsedIndentItem[]
  rawText: string
  warnings: string[]
}

// ── Regexes ───────────────────────────────────────────────────────────────────

const CODE_8_RE = /0\d{7}/
const CODE_4_ALONE_RE = /^(1[0-9]\d{2})$/
const SIZE_PACK_RE = /(\d{2,3})\s*ML\s*[xX×]\s*(\d+)\s*P?\.?\s*(?:Btls?|Cans?|ABP)/i
const SIZE_ONLY_RE = /(\d{2,3})\s*ML/i

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, "")) || 0
}

function normalizeDate(raw: string): string {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw)
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim()
  return raw.trim()
}

function extractSizeInfo(text: string): { sizeMl: number; bottlesPerCase: number } {
  const packMatch = SIZE_PACK_RE.exec(text)
  if (packMatch) return { sizeMl: parseInt(packMatch[1]), bottlesPerCase: parseInt(packMatch[2]) }
  const sizeMatch = SIZE_ONLY_RE.exec(text)
  if (sizeMatch) {
    const sizeMl = parseInt(sizeMatch[1])
    const defaults: Record<number, number> = {
      60: 150, 90: 96, 180: 48, 200: 48, 275: 24,
      330: 24, 375: 24, 500: 24, 650: 12, 750: 12,
    }
    return { sizeMl, bottlesPerCase: defaults[sizeMl] ?? 12 }
  }
  return { sizeMl: 0, bottlesPerCase: 12 }
}

function cleanItemName(raw: string): string {
  return raw
    .replace(CODE_8_RE, "")
    .replace(/\b1[0-9]\d{2}\b/g, "")
    .replace(/\(\d{4}\)/g, "")
    .replace(SIZE_PACK_RE, "")
    .replace(SIZE_ONLY_RE, "")
    .replace(/AB\.?\s*Pack/gi, "")
    .replace(/\b\d{3}\b(?!\s*[-–])/g, "")
    .replace(/\s+/g, " ")
    .replace(/[-–,\s]+$/, "")
    .trim()
}

// ── Numeric group parser ──────────────────────────────────────────────────────
//
// KSBCL PDFs concatenate all numeric columns with no separators, e.g.:
//   "4143.49208286.98208286.98"
//   = rate(4143.49) indCBS(2) indBTLS(0) indAmt(8286.98) cnfCBS(2) cnfBTLS(0) cnfAmt(8286.98)
//
// For CBS>0: indAmt = CBS × rate (used to locate amount boundary)
// For CBS=0: the amount is the first decimal number after BTLS

type NumGroup = { cbs: number; btls: number; amt: number; rest: string }

function tryGroup(s: string, rate: number): NumGroup | null {
  for (let cl = 1; cl <= 3; cl++) {
    const cbsStr = s.slice(0, cl)
    if (!/^\d+$/.test(cbsStr)) break
    const cbs = parseInt(cbsStr)
    const afterCbs = s.slice(cl)

    for (let bl = 1; bl <= 3; bl++) {
      const btlsStr = afterCbs.slice(0, bl)
      if (!/^\d+$/.test(btlsStr)) break
      const btls = parseInt(btlsStr)
      const afterBtls = afterCbs.slice(bl)

      if (cbs > 0) {
        const expectedAmt = Math.round(cbs * rate * 100) / 100
        for (const amtStr of [String(expectedAmt), expectedAmt.toFixed(2)]) {
          if (afterBtls.startsWith(amtStr)) {
            return { cbs, btls, amt: expectedAmt, rest: afterBtls.slice(amtStr.length) }
          }
        }
      } else {
        const m = /^(\d+\.\d{1,2})(.*)$/.exec(afterBtls)
        if (m) {
          return { cbs: 0, btls, amt: parseNum(m[1]), rest: m[2] }
        }
        // Whole-number amount when CBS=0 (rare but possible)
        const wm = /^(\d{3,})(.*)$/.exec(afterBtls)
        if (wm && wm[2] === "") {
          return { cbs: 0, btls, amt: parseNum(wm[1]), rest: "" }
        }
      }
    }
  }
  return null
}

// Parse the 7 numeric fields from a merged string (rate, indCBS, indBTLS, indAmt, cnfCBS, cnfBTLS, cnfAmt).
// The string may be prefixed by a 4-digit item code — strip it first if detected.
function parseMergedNumbers(raw: string): {
  code4: string | null
  rate: number
  indCbs: number; indBtls: number; indAmt: number
  cnfCbs: number; cnfBtls: number; cnfAmt: number
} | null {
  const s = raw.trim()
  if (!s || !/^\d/.test(s)) return null

  // Detect glued 4-digit code prefix: 4 digits where digit 5 starts a plausible rate
  let code4: string | null = null
  const c4m = /^(1[0-9]\d{2})(\d{3,6}\.?\d*)/.exec(s)
  if (c4m) {
    // Tentatively strip the code and try parsing the rest
    const candidate = s.slice(4)
    const parsed = tryParseSevenFields(candidate)
    if (parsed) {
      code4 = c4m[1]
      const [rate, indCbs, indBtls, indAmt, cnfCbs, cnfBtls, cnfAmt] = parsed
      return { code4, rate, indCbs, indBtls, indAmt, cnfCbs, cnfBtls, cnfAmt }
    }
  }

  const parsed = tryParseSevenFields(s)
  if (!parsed) return null
  const [rate, indCbs, indBtls, indAmt, cnfCbs, cnfBtls, cnfAmt] = parsed
  return { code4: null, rate, indCbs, indBtls, indAmt, cnfCbs, cnfBtls, cnfAmt }
}

function tryParseSevenFields(s: string): [number, number, number, number, number, number, number] | null {
  // Build rate candidates: decimal first, then whole-number prefixes
  const candidates: Array<{ rate: number; rest: string }> = []

  const dm = /^(\d{2,6}\.\d{2})(.*)$/.exec(s)
  if (dm) candidates.push({ rate: parseNum(dm[1]), rest: dm[2] })

  for (let len = 6; len >= 3; len--) {
    const rStr = s.slice(0, len)
    if (!/^\d+$/.test(rStr)) continue
    const r = parseInt(rStr)
    if (r < 50) continue
    // Don't duplicate what dm already covers
    if (dm && s.startsWith(dm[1].replace(".", ""))) continue
    candidates.push({ rate: r, rest: s.slice(len) })
  }

  for (const { rate, rest } of candidates) {
    const g1 = tryGroup(rest, rate)
    if (!g1) continue
    const g2 = tryGroup(g1.rest, rate)
    if (!g2) continue
    if (g2.rest.trim()) continue
    return [rate, g1.cbs, g1.btls, g1.amt, g2.cbs, g2.btls, g2.amt]
  }

  return null
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function parseKsbclPdf(buffer: Buffer): Promise<ParsedIndent> {
  const data = await pdfParse(buffer)
  const text = data.text
  const warnings: string[] = []

  // Header fields
  const retailerFull = /RETAILER:\s*(.+?)(?:\s*INDENT\s*NO|\s*$)/i.exec(text)?.[1]?.trim() ?? ""
  const retailerIdMatch = /\((\d{4,6})\)/.exec(retailerFull)
  const retailerId = retailerIdMatch?.[1] ?? ""
  const retailerName = retailerFull.replace(/\(\d+\)/, "").trim()
  const indentNumber = /INDENT\s*NO\s*[:\s]+([A-Z0-9-/]+)/i.exec(text)?.[1]?.trim() ?? ""
  const invoiceNumber = /INVOICE\s*NO\s*[:\s]+([A-Z0-9-/]+)/i.exec(text)?.[1]?.trim() ?? ""
  const dateRaw = /PRINTED\s*ON\s*[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text)?.[1] ?? ""
  const indentDate = normalizeDate(dateRaw)
  const totalRationedItems = parseInt(/(\d+)\s*Rationed\s*Items/i.exec(text)?.[1] ?? "0")

  if (!indentNumber) warnings.push("Could not parse indent number from PDF")
  if (!retailerId) warnings.push("Could not parse retailer ID from PDF")

  // Slice the table region
  const tableStart = text.indexOf("SR NO")
  const totalMatch = /\bTOTAL\b/.exec(text)
  const tableText = text.slice(
    tableStart > 0 ? tableStart : 0,
    totalMatch ? totalMatch.index : text.length,
  )

  // Split into lines, drop table header lines
  const TABLE_HEADER_WORDS = new Set(["SR NO", "ITEM NAME", "ITEM CODE", "RATE", "(PER CB.)", "INDENT", "CBS", "BTLS", "AMOUNT", "CNF"])
  const rawLines = tableText.split("\n").map((l) => l.trim()).filter(Boolean)
  const lines = rawLines.filter((l) => {
    const up = l.toUpperCase()
    return !TABLE_HEADER_WORDS.has(up)
      && !/^SR\s*NO\.?/i.test(l)
      && !/^ITEM\s*NAME/i.test(l)
  })

  // Walk lines: whenever we see a standalone 1-2 digit SR number, start a new segment
  type Segment = { srNo: number; lines: string[] }
  const segments: Segment[] = []
  let current: Segment | null = null

  for (const line of lines) {
    const srMatch = /^(\d{1,2})$/.exec(line)
    if (srMatch) {
      if (current) segments.push(current)
      current = { srNo: parseInt(srMatch[1]), lines: [] }
    } else {
      if (!current) current = { srNo: 0, lines: [] }
      current.lines.push(line)
    }
  }
  if (current) segments.push(current)

  if (segments.length === 0) {
    warnings.push(`No table rows found. Table text snippet: "${tableText.slice(0, 200).replace(/\n/g, " ↵ ")}"`)
    return { indentNumber, invoiceNumber, retailerId, retailerName, indentDate, totalRationedItems, totalIndentValue: 0, totalConfirmedValue: 0, items: [], rawText: text, warnings }
  }

  // Parse each segment
  const items: ParsedIndentItem[] = []

  for (const seg of segments) {
    // Find the numeric line (last line that parses successfully)
    let numericIdx = -1
    let parsed: ReturnType<typeof parseMergedNumbers> = null

    for (let i = seg.lines.length - 1; i >= 0; i--) {
      const result = parseMergedNumbers(seg.lines[i])
      if (result) {
        numericIdx = i
        parsed = result
        break
      }
    }

    if (!parsed || numericIdx === -1) {
      warnings.push(`SR${seg.srNo}: could not parse numeric line from "${seg.lines.join(" | ").slice(0, 80)}"`)
      continue
    }

    const descLines = seg.lines.slice(0, numericIdx)

    // Extract item code from desc lines
    let baseCode = ""
    let subCode = ""

    // 8-digit code: look for it in desc lines
    for (const dl of descLines) {
      const m8 = CODE_8_RE.exec(dl)
      if (m8) {
        baseCode = m8[0]
        // subcode is a standalone 3-digit line following the base code line
        const idx = descLines.indexOf(dl)
        const next = descLines[idx + 1]?.trim() ?? ""
        if (/^\d{3}$/.test(next)) subCode = next
        break
      }
    }

    // 4-digit code: either glued to numeric line (parsed.code4) or standalone line
    if (!baseCode) {
      if (parsed.code4) {
        baseCode = parsed.code4
      } else {
        for (const dl of descLines) {
          if (CODE_4_ALONE_RE.test(dl.trim())) {
            baseCode = dl.trim()
            break
          }
        }
      }
    }

    // Item name = desc lines minus code lines
    const codeLines = new Set<string>()
    if (baseCode) codeLines.add(baseCode)
    if (subCode) codeLines.add(subCode)
    const nameLines = descLines.filter((dl) => !codeLines.has(dl.trim()))
    const rawItemName = nameLines.join(" ").trim()
    const itemName = cleanItemName(rawItemName)
    const { sizeMl, bottlesPerCase } = extractSizeInfo(rawItemName)

    const ksbclItemCode = subCode ? `${baseCode}${subCode}` : baseCode

    const { rate, indCbs, indBtls, indAmt, cnfCbs, cnfBtls, cnfAmt } = parsed
    const isNotAllocated = cnfCbs === 0 && cnfBtls === 0
    const isRationed = !isNotAllocated && (cnfCbs < indCbs || cnfBtls < indBtls)

    items.push({
      srNo: seg.srNo || items.length + 1,
      ksbclItemCode,
      ksbclBaseCode: baseCode,
      ksbclSubCode: subCode,
      itemName,
      rawItemName,
      sizeMl,
      bottlesPerCase,
      ratePerCase: rate,
      indentCases: indCbs,
      indentBottles: indBtls,
      indentAmount: indAmt,
      cnfCases: cnfCbs,
      cnfBottles: cnfBtls,
      cnfAmount: cnfAmt,
      isRationed,
      isNotAllocated,
    })
  }

  const computedRationed = items.filter((i) => i.isRationed).length
  if (totalRationedItems > 0 && computedRationed !== totalRationedItems) {
    warnings.push(`Rationed count mismatch: PDF says ${totalRationedItems}, computed ${computedRationed}`)
  }

  const totalIndentValue = items.reduce((s, i) => s + i.indentAmount, 0)
  const totalConfirmedValue = items.reduce((s, i) => s + i.cnfAmount, 0)

  return {
    indentNumber, invoiceNumber, retailerId, retailerName, indentDate,
    totalRationedItems, totalIndentValue, totalConfirmedValue,
    items, rawText: text, warnings,
  }
}
