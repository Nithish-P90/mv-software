"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { PageShell } from "@/components/PageShell"
import { Button } from "@/components/ui/Button"

type IndentRow = {
  id: number
  indentNumber: string
  invoiceNumber: string
  retailerId: string
  retailerName: string
  indentDate: string
  status: string
  items: { id: number; cnfAmount: string | number; indentAmount: string | number; isRationed: boolean }[]
  receipts: { id: number }[]
}

export default function IndentsPage() {
  const router = useRouter()
  const [indents, setIndents] = useState<IndentRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/indents")
      .then((r) => r.json())
      .then((d) => { setIndents(Array.isArray(d) ? d : []); setLoading(false) })
  }, [])

  const STATUS_COLORS: Record<string, string> = {
    PENDING: "bg-amber-100 text-amber-700 border-amber-200",
    PARTIAL: "bg-blue-100 text-blue-700 border-blue-200",
    FULLY_RECEIVED: "bg-emerald-100 text-emerald-700 border-emerald-200",
    STOCK_ADDED: "bg-slate-900 text-white border-slate-900",
  }

  return (
    <PageShell title="Indents">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-900">Procurement Register</h2>
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mt-0.5">KSBCL Indent History</p>
        </div>
        <Button variant="primary" onClick={() => router.push("/indents/upload")} className="flex items-center gap-2">
          <Plus size={15} /> Upload PDF
        </Button>
      </div>

      {loading ? (
        <p className="text-center py-10 text-[11px] font-black uppercase tracking-widest text-slate-400 animate-pulse">Loading…</p>
      ) : indents.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-100 py-16 text-center">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">No indents uploaded yet</p>
          <button onClick={() => router.push("/indents/upload")}
            className="mt-4 text-xs font-black uppercase tracking-widest text-slate-600 hover:text-slate-900 transition-colors underline underline-offset-4">
            Upload first indent →
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-100 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-100">
              <tr>
                <th className="px-5 py-3">Indent No</th>
                <th className="px-5 py-3">Retailer</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3 text-right">CNF Value</th>
                <th className="px-5 py-3">Items</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {indents.map((indent) => {
                const cnfValue = indent.items.reduce((s, i) => s + Number(i.cnfAmount), 0)
                const rationedCount = indent.items.filter((i) => i.isRationed).length
                return (
                  <tr key={indent.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs font-black text-slate-800">{indent.indentNumber}</td>
                    <td className="px-5 py-3">
                      <p className="text-xs font-bold text-slate-700">{indent.retailerName}</p>
                      <p className="text-[10px] text-slate-400">#{indent.retailerId}</p>
                    </td>
                    <td className="px-5 py-3 text-[10px] font-bold text-slate-500">
                      {indent.indentDate ? new Date(indent.indentDate).toLocaleDateString("en-GB") : "—"}
                    </td>
                    <td className="px-5 py-3 text-right text-xs font-black text-slate-800 tabular-nums">
                      ₹{cnfValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-bold text-slate-600">{indent.items.length}</span>
                      {rationedCount > 0 && (
                        <span className="ml-2 text-[9px] font-black uppercase text-amber-600">{rationedCount} rationed</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded-lg border px-2 py-1 text-[9px] font-black uppercase tracking-widest ${STATUS_COLORS[indent.status] ?? "bg-slate-100 text-slate-500 border-slate-200"}`}>
                        {indent.status?.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <button onClick={() => router.push(`/indents/${indent.id}`)}
                        className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 transition-colors">
                        View →
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}
