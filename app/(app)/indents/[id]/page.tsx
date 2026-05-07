"use client"
import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { CheckCircle2, AlertTriangle } from "lucide-react"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

type IndentItem = {
  id: number
  cnfCases: number
  cnfBottles: number
  cnfAmount: string | number
  isRationed: boolean
  rawItemName: string | null
  productSizeId: number | null
  productSize: { sizeMl: number; bottlesPerCase: number; product: { name: string } } | null
}

type IndentDetail = {
  id: number
  indentNumber: string
  invoiceNumber: string
  indentDate: string
  status: string
  items: IndentItem[]
}

export default function IndentDetailPage() {
  const router = useRouter()
  const { id } = useParams()
  const [indent, setIndent] = useState<IndentDetail | null>(null)
  const [receiveQtys, setReceiveQtys] = useState<Record<number, { casesReceived: number; bottlesReceived: number }>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/indents")
      .then((r) => r.json())
      .then((data: IndentDetail[]) => {
        const found = data.find((d) => d.id === parseInt(id as string))
        if (found) {
          setIndent(found)
          const init: Record<number, { casesReceived: number; bottlesReceived: number }> = {}
          found.items.forEach((item) => {
            init[item.id] = { casesReceived: item.cnfCases, bottlesReceived: item.cnfBottles }
          })
          setReceiveQtys(init)
        }
        setLoading(false)
      })
  }, [id])

  async function receiveStock() {
    if (!indent) return
    setSaving(true)
    setError("")
    try {
      const items = indent.items.map((item) => ({
        indentItemId: item.id,
        productSizeId: item.productSizeId,
        casesReceived: receiveQtys[item.id]?.casesReceived ?? 0,
        bottlesReceived: receiveQtys[item.id]?.bottlesReceived ?? 0,
        bottlesPerCase: item.productSize?.bottlesPerCase ?? 12,
      }))
      const res = await fetch("/api/indents/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ indentId: indent.id, items, notes }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? "Failed to receive stock")
        return
      }
      router.push("/indents")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to receive stock")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <PageShell title="Indent">
        <p className="py-10 text-center text-[11px] font-black uppercase tracking-widest text-slate-400 animate-pulse">Loading…</p>
      </PageShell>
    )
  }

  if (!indent) {
    return (
      <PageShell title="Indent">
        <p className="text-sm font-bold text-rose-600">Indent not found</p>
      </PageShell>
    )
  }

  const isConfirmed = indent.status === "STOCK_ADDED" || indent.status === "FULLY_RECEIVED"

  return (
    <PageShell title={indent.indentNumber}>
      {/* Header */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: "Invoice", value: indent.invoiceNumber },
          { label: "Date", value: indent.indentDate ? new Date(indent.indentDate).toLocaleDateString("en-GB") : "—" },
          { label: "Status", value: indent.status?.replace(/_/g, " ") },
        ].map((f) => (
          <div key={f.label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{f.label}</p>
            <p className="mt-0.5 text-xs font-bold text-slate-800">{f.value || "—"}</p>
          </div>
        ))}
      </div>

      {isConfirmed && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 size={15} className="text-emerald-600" />
          <p className="text-xs font-black text-emerald-700">Stock already added to inventory</p>
        </div>
      )}

      {!isConfirmed && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
          Quantities pre-filled from CNF amounts. Adjust if delivery was short.
        </div>
      )}

      {/* Items table */}
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="w-full min-w-[600px] text-left">
          <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-500">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3 w-20 text-center text-emerald-700">CNF Cases</th>
              <th className="px-4 py-3 w-20 text-center text-emerald-700">CNF Btls</th>
              <th className="px-4 py-3 w-28 text-center text-blue-700">Received Cases</th>
              <th className="px-4 py-3 w-28 text-center text-blue-700">Received Btls</th>
              <th className="px-4 py-3 w-24 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {indent.items.map((item) => (
              <tr key={item.id} className={`${item.isRationed ? "bg-amber-50/40" : ""} hover:bg-slate-50/60 transition-colors`}>
                <td className="px-4 py-3">
                  <p className="text-xs font-bold text-slate-900">
                    {item.productSize
                      ? `${item.productSize.product?.name} ${item.productSize.sizeMl}ml`
                      : item.rawItemName || "Unknown"}
                  </p>
                  {item.isRationed && (
                    <span className="flex items-center gap-1 text-[9px] font-black uppercase text-amber-600">
                      <AlertTriangle size={9} /> Rationed
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-center text-xs font-black text-emerald-700">{item.cnfCases}</td>
                <td className="px-4 py-3 text-center text-xs font-black text-emerald-700">{item.cnfBottles}</td>
                <td className="px-4 py-3 text-center">
                  {isConfirmed ? (
                    <span className="text-xs font-bold text-slate-500">{receiveQtys[item.id]?.casesReceived ?? item.cnfCases}</span>
                  ) : (
                    <input type="number" min="0" value={receiveQtys[item.id]?.casesReceived ?? 0}
                      onChange={(e) => setReceiveQtys({ ...receiveQtys, [item.id]: { ...receiveQtys[item.id], casesReceived: +e.target.value } })}
                      className="w-20 rounded-md border border-slate-200 px-2 py-1 text-center text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {isConfirmed ? (
                    <span className="text-xs font-bold text-slate-500">{receiveQtys[item.id]?.bottlesReceived ?? item.cnfBottles}</span>
                  ) : (
                    <input type="number" min="0" value={receiveQtys[item.id]?.bottlesReceived ?? 0}
                      onChange={(e) => setReceiveQtys({ ...receiveQtys, [item.id]: { ...receiveQtys[item.id], bottlesReceived: +e.target.value } })}
                      className="w-20 rounded-md border border-slate-200 px-2 py-1 text-center text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-right text-[10px] font-bold text-slate-600 tabular-nums">
                  ₹{Number(item.cnfAmount).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!isConfirmed && (
        <>
          <div className="mt-4">
            <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Notes (optional)</p>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              placeholder="e.g. Short delivery on 3 items"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          {error && (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">{error}</p>
          )}

          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={receiveStock} disabled={saving} className="flex items-center gap-2">
              <CheckCircle2 size={14} />
              {saving ? "Saving…" : "Confirm Stock Received"}
            </Button>
          </div>
        </>
      )}
    </PageShell>
  )
}
