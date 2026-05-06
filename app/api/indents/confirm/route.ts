import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { matchVariants } from "@/lib/ksbcl-match"
import { apiError } from "@/lib/zod-schemas"
import { todayDateString } from "@/lib/dates"

type ConfirmItem = {
  srNo: number
  itemCode: string
  itemName: string
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

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult
  const actorId = parseInt(authResult.id, 10)

  try {
    const { header, items }: { header: Record<string, string | number>; items: ConfirmItem[] } = await req.json()

    const indentNumber = String(header.indentNumber || `UNKNOWN-${Date.now()}`)

    // Match items to product sizes via KSBCL codes
    const parsedItems = items.map((i) => ({
      srNo: i.srNo,
      ksbclItemCode: i.itemCode,
      ksbclBaseCode: i.itemCode.slice(0, 8),
      ksbclSubCode: i.itemCode.slice(8),
      itemName: i.itemName,
      rawItemName: i.itemName,
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
    }))

    const matches = await matchVariants(parsedItems)

    const indentId = await prisma.$transaction(async (tx) => {
      const indent = await tx.indent.upsert({
        where: { indentNumber },
        update: {
          totalIndentValue: items.reduce((s, i) => s + i.indentAmount, 0),
          totalConfirmedValue: items.reduce((s, i) => s + i.cnfAmount, 0),
        },
        create: {
          indentNumber,
          invoiceNumber: String(header.invoiceNumber || indentNumber),
          retailerId: String(header.retailerId || "UNKNOWN"),
          retailerName: String(header.retailerName || "UNKNOWN"),
          indentDate: header.indentDate ? new Date(String(header.indentDate)) : new Date(todayDateString()),
          pdfPath: "",
          rawText: "",
          parseWarnings: [],
          totalIndentValue: items.reduce((s, i) => s + i.indentAmount, 0),
          totalConfirmedValue: items.reduce((s, i) => s + i.cnfAmount, 0),
        },
      })

      // Delete existing items on re-parse
      await tx.indentItem.deleteMany({ where: { indentId: indent.id } })

      for (const match of matches) {
        await tx.indentItem.create({
          data: {
            indentId: indent.id,
            productId: match.productId ?? undefined,
            productSizeId: match.productSizeId ?? undefined,
            ksbclItemCode: match.parsedItem.ksbclItemCode,
            rawItemName: match.parsedItem.rawItemName || match.parsedItem.itemName,
            parseConfidence: 1.0,
            mappingConfidence: match.confidence,
            isNewItem: match.isNewItem,
            isRationed: match.parsedItem.isRationed,
            ratePerCase: match.parsedItem.ratePerCase,
            indentCases: match.parsedItem.indentCases,
            indentBottles: match.parsedItem.indentBottles,
            indentAmount: match.parsedItem.indentAmount,
            cnfCases: match.parsedItem.cnfCases,
            cnfBottles: match.parsedItem.cnfBottles,
            cnfAmount: match.parsedItem.cnfAmount,
          },
        })
      }

      // Immediately add stock for matched items
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)

      const receipt = await tx.receipt.create({
        data: { indentId: indent.id, receivedDate: today, staffId: actorId },
      })

      for (const match of matches) {
        if (!match.productSizeId || match.isNewItem) continue
        const item = match.parsedItem
        if (item.cnfCases === 0 && item.cnfBottles === 0) continue

        const size = await tx.productSize.findUnique({
          where: { id: match.productSizeId },
          select: { bottlesPerCase: true },
        })
        const totalBottles = item.cnfCases * (size?.bottlesPerCase ?? item.bottlesPerCase) + item.cnfBottles

        await tx.receiptItem.create({
          data: {
            receiptId: receipt.id,
            productSizeId: match.productSizeId,
            casesReceived: item.cnfCases,
            bottlesReceived: item.cnfBottles,
            totalBottles,
          },
        })
      }

      await tx.indent.update({
        where: { id: indent.id },
        data: { status: "STOCK_ADDED" },
      })

      await tx.auditEvent.create({
        data: {
          actorId,
          eventType: "INDENT_CONFIRMED",
          entity: "Indent",
          entityId: indent.id,
          afterSnapshot: { receiptId: receipt.id },
        },
      })

      return indent.id
    })

    return Response.json({ indentId })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Confirm failed", 500)
  }
}
