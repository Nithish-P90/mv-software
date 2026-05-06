import { requireAdmin } from "@/lib/api-auth"
import { parseKsbclPdf } from "@/lib/ksbcl-parser"
import { apiError } from "@/lib/zod-schemas"

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult

  try {
    const formData = await req.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) return apiError("No PDF file provided")

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = await parseKsbclPdf(buffer)

    const totals = parsed.items.reduce(
      (acc, i) => ({
        indentCases: acc.indentCases + i.indentCases,
        indentBottles: acc.indentBottles + i.indentBottles,
        indentAmount: acc.indentAmount + i.indentAmount,
        cnfCases: acc.cnfCases + i.cnfCases,
        cnfBottles: acc.cnfBottles + i.cnfBottles,
        cnfAmount: acc.cnfAmount + i.cnfAmount,
      }),
      { indentCases: 0, indentBottles: 0, indentAmount: 0, cnfCases: 0, cnfBottles: 0, cnfAmount: 0 },
    )

    const pdfPath = `data:application/pdf;base64,${buffer.toString("base64")}`

    return Response.json({
      parsed: {
        header: {
          indentNumber: parsed.indentNumber,
          invoiceNumber: parsed.invoiceNumber,
          retailerId: parsed.retailerId,
          retailerName: parsed.retailerName,
          indentDate: parsed.indentDate,
          rationedCount: parsed.totalRationedItems,
        },
        items: parsed.items.map((i) => ({
          srNo: i.srNo,
          itemName: i.itemName,
          itemCode: i.ksbclItemCode,
          sizeMl: i.sizeMl,
          bottlesPerCase: i.bottlesPerCase,
          ratePerCase: i.ratePerCase,
          indentCases: i.indentCases,
          indentBottles: i.indentBottles,
          indentAmount: i.indentAmount,
          cnfCases: i.cnfCases,
          cnfBottles: i.cnfBottles,
          cnfAmount: i.cnfAmount,
          isRationed: i.isRationed,
          isNotAllocated: i.isNotAllocated,
        })),
        totals,
        warnings: parsed.warnings,
      },
      pdfPath,
      ocrText: parsed.rawText,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Parse failed", 500)
  }
}
