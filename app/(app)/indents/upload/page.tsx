"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Upload, AlertTriangle, CheckCircle, RotateCcw } from "lucide-react"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

type ParsedIndentItem = {
  srNo: number
  itemName: string
  itemCode: string
  ratePerCase: number
  indentCases: number
  indentBottles: number
  indentAmount: number
  cnfCases: number
  cnfBottles: number
  cnfAmount: number
  isRationed: boolean
  isNotAllocated: boolean
  sizeMl: number
  bottlesPerCase: number
}

type ParsedPreview = {
  header: {
    indentNumber: string
    invoiceNumber: string
    retailerId: string
    retailerName: string
    indentDate: string
    rationedCount: number
  }
  items: ParsedIndentItem[]
  totals: {
    indentCases: number; indentBottles: number; indentAmount: number
    cnfCases: number; cnfBottles: number; cnfAmount: number
  }
  warnings: string[]
}

type EditRow = { srNo: number; cnfCases: number; cnfBottles: number }

export default function IndentUploadPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedPreview | null>(null)
  const [editRows, setEditRows] = useState<EditRow[]>([])
  const [pdfPath, setPdfPath] = useState("")
  const [ocrText, setOcrText] = useState("")
  const [showOcr, setShowOcr] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState("")

  function initEditRows(items: ParsedIndentItem[]) {
    setEditRows(items.map((i) => ({ srNo: i.srNo, cnfCases: i.cnfCases, cnfBottles: i.cnfBottles })))
  }

  function updateEdit(srNo: number, field: "cnfCases" | "cnfBottles", raw: string) {
    const val = Math.max(0, parseInt(raw) || 0)
    setEditRows((prev) => prev.map((r) => (r.srNo === srNo ? { ...r, [field]: val } : r)))
  }

  function getEdit(srNo: number): EditRow {
    return editRows.find((r) => r.srNo === srNo) ?? { srNo, cnfCases: 0, cnfBottles: 0 }
  }

  function totalBottles(item: ParsedIndentItem, edit: EditRow) {
    return edit.cnfCases * item.bottlesPerCase + edit.cnfBottles
  }

  function needsReview(item: ParsedIndentItem, edit: EditRow) {
    return totalBottles(item, edit) === 0 && item.cnfAmount > 0
  }

  async function handleUpload() {
    if (!file) return
    setLoading(true)
    setError("")
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/indents/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Upload failed"); return }
      setParsed(data.parsed)
      setPdfPath(data.pdfPath)
      setOcrText(data.ocrText ?? "")
      initEditRows(data.parsed.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!parsed) return
    setConfirming(true)
    setError("")
    try {
      const mergedItems = parsed.items.map((item) => {
        const edit = getEdit(item.srNo)
        return { ...item, cnfCases: edit.cnfCases, cnfBottles: edit.cnfBottles }
      })
      const res = await fetch("/api/indents/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ header: parsed.header, items: mergedItems }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Confirm failed"); return }
      router.push("/indents")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirm failed")
    } finally {
      setConfirming(false)
    }
  }

  const liveTotals = parsed
    ? parsed.items.reduce((acc, item) => {
        const edit = getEdit(item.srNo)
        return {
          cases: acc.cases + edit.cnfCases,
          bottles: acc.bottles + edit.cnfBottles,
          totalBottles: acc.totalBottles + totalBottles(item, edit),
        }
      }, { cases: 0, bottles: 0, totalBottles: 0 })
    : null

  const reviewCount = parsed ? parsed.items.filter((i) => needsReview(i, getEdit(i.srNo))).length : 0

  if (!parsed) {
    return (
      <PageShell title="Upload Indent PDF">
        <div
          onClick={() => document.getElementById("pdf-upload")?.click()}
          className="flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-200 transition-all hover:border-slate-400 hover:bg-slate-50"
        >
          <input id="pdf-upload" type="file" accept=".pdf" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {loading ? (
            <div className="flex flex-col items-center gap-2">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Parsing PDF…</p>
            </div>
          ) : (
            <>
              <Upload size={26} className="text-slate-300" />
              <p className="text-sm font-bold text-slate-500">Drop KSBCL indent PDF here or click to browse</p>
              {file && <p className="text-xs font-black text-emerald-600">✓ {file.name}</p>}
            </>
          )}
        </div>

        {file && !loading && (
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={handleUpload}>Parse & Preview</Button>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{error}</p>
        )}
      </PageShell>
    )
  }

  return (
    <PageShell title={parsed.header.indentNumber || "Verify Indent"}>
      {/* Header cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Indent No", value: parsed.header.indentNumber },
          { label: "Invoice No", value: parsed.header.invoiceNumber },
          { label: "Retailer", value: `${parsed.header.retailerName} (${parsed.header.retailerId})` },
          { label: "Date", value: parsed.header.indentDate },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{f.label}</p>
            <p className="mt-0.5 truncate text-xs font-bold text-slate-800">{f.value || "—"}</p>
          </div>
        ))}
      </div>

      {/* Summary pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        <span className="rounded-md bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600">
          {parsed.items.length} items
        </span>
        <span className="rounded-md bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-700">
          CNF ₹{parsed.totals.cnfAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
        </span>
        <span className="rounded-md bg-blue-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-blue-700">
          {liveTotals?.totalBottles.toLocaleString("en-IN")} bottles receiving
        </span>
        {parsed.header.rationedCount > 0 && (
          <span className="rounded-md bg-amber-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700">
            <AlertTriangle size={10} className="inline mr-1" />{parsed.header.rationedCount} rationed
          </span>
        )}
        {reviewCount > 0 && (
          <span className="rounded-md bg-rose-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-rose-600">
            {reviewCount} need review
          </span>
        )}
      </div>

      {/* Warnings */}
      {parsed.warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-amber-700">Parse Warnings</p>
          {parsed.warnings.map((w, i) => <p key={i} className="text-xs text-amber-700">• {w}</p>)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Items table */}
        <div className="overflow-x-auto rounded-xl border border-slate-100 lg:col-span-2">
          <table className="w-full min-w-[700px] text-left">
            <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-3 py-2.5 w-8">#</th>
                <th className="px-3 py-2.5">Item</th>
                <th className="px-3 py-2.5 w-28">Code</th>
                <th className="px-3 py-2.5 w-20 text-right">Rate/cs</th>
                <th className="px-3 py-2.5 w-16 text-center text-slate-400">Ind CBS</th>
                <th className="px-3 py-2.5 w-16 text-center text-slate-400">Ind Btl</th>
                <th className="px-3 py-2.5 w-20 text-right text-slate-400">Ind ₹</th>
                <th className="px-3 py-2.5 w-20 text-center text-emerald-700">CNF cs</th>
                <th className="px-3 py-2.5 w-20 text-center text-emerald-700">CNF bt</th>
                <th className="px-3 py-2.5 w-16 text-center text-blue-700">Btls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {parsed.items.map((item) => {
                const edit = getEdit(item.srNo)
                const btls = totalBottles(item, edit)
                const review = needsReview(item, edit)
                const rowBg = review ? "bg-rose-50/40" : item.isRationed ? "bg-amber-50/40" : item.isNotAllocated ? "opacity-50" : ""
                return (
                  <tr key={item.srNo} className={`${rowBg} hover:bg-slate-50/60 transition-colors`}>
                    <td className="px-3 py-2 text-[10px] font-black text-slate-400">{item.srNo}</td>
                    <td className="px-3 py-2">
                      <p className="text-xs font-bold text-slate-900 leading-snug max-w-[160px] truncate">{item.itemName}</p>
                      <p className="text-[9px] text-slate-400">{item.sizeMl}ml · {item.bottlesPerCase}/cs</p>
                      {item.isRationed && <span className="text-[9px] font-black uppercase text-amber-600">Rationed</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-600">{item.itemCode}</td>
                    <td className="px-3 py-2 text-right text-[10px] font-bold text-slate-600 tabular-nums">
                      ₹{item.ratePerCase.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-2 text-center text-[10px] text-slate-400">{item.indentCases}</td>
                    <td className="px-3 py-2 text-center text-[10px] text-slate-400">{item.indentBottles}</td>
                    <td className="px-3 py-2 text-right text-[10px] text-slate-400 tabular-nums">
                      ₹{item.indentAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min={0} value={edit.cnfCases}
                        onChange={(e) => updateEdit(item.srNo, "cnfCases", e.target.value)}
                        className="w-14 rounded-md border border-emerald-200 bg-white px-1.5 py-1 text-center text-xs font-bold text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="number" min={0} value={edit.cnfBottles}
                        onChange={(e) => updateEdit(item.srNo, "cnfBottles", e.target.value)}
                        className="w-14 rounded-md border border-emerald-200 bg-white px-1.5 py-1 text-center text-xs font-bold text-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-sm font-black ${review ? "text-rose-500" : btls > 0 ? "text-blue-700" : "text-slate-300"}`}>
                        {btls}
                      </span>
                      {review && <p className="text-[8px] font-black uppercase text-rose-400">Review</p>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-blue-50/60">
              <tr>
                <td colSpan={9} className="px-3 py-2.5 text-right text-[10px] font-black uppercase tracking-wider text-blue-700">
                  Total bottles being added to inventory
                </td>
                <td className="px-3 py-2.5 text-center text-base font-black text-blue-800 tabular-nums">
                  {liveTotals?.totalBottles.toLocaleString("en-IN")}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* PDF Preview */}
        <div className="rounded-xl border border-slate-100 p-3 lg:col-span-1">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">PDF Preview</p>
            <button onClick={() => setShowOcr((s) => !s)}
              className="text-[9px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-700 transition-colors">
              {showOcr ? "Hide OCR" : "Show OCR"}
            </button>
          </div>
          {showOcr ? (
            <div className="h-[600px] overflow-auto rounded-lg border border-slate-100 bg-slate-50 p-3">
              <pre className="text-[9px] font-mono text-slate-600 whitespace-pre-wrap">{ocrText}</pre>
            </div>
          ) : (
            <div className="h-[600px] overflow-hidden rounded-lg border border-slate-100">
              <iframe src={pdfPath} title="Indent PDF" className="h-full w-full" />
            </div>
          )}
          <a href={pdfPath} download="indent.pdf"
            className="mt-2 block text-center text-[9px] font-black uppercase tracking-wider text-slate-400 hover:text-slate-700 transition-colors">
            Download PDF
          </a>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{error}</p>
      )}

      {/* Actions */}
      <div className="mt-5 flex items-center justify-between">
        <button onClick={() => { setParsed(null); setFile(null); setEditRows([]) }}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors">
          <RotateCcw size={13} /> Upload different PDF
        </button>
        <div className="flex gap-3">
          {reviewCount > 0 && (
            <p className="flex items-center text-xs font-bold text-rose-600">
              <AlertTriangle size={13} className="mr-1" /> Fix {reviewCount} flagged row{reviewCount > 1 ? "s" : ""} first
            </p>
          )}
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={confirming || reviewCount > 0}
            className="flex items-center gap-2"
          >
            <CheckCircle size={14} />
            {confirming ? "Adding to inventory…" : "Confirm & Add to Inventory"}
          </Button>
        </div>
      </div>
    </PageShell>
  )
}
