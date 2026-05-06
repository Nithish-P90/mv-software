import { requireAdmin } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { apiError } from "@/lib/zod-schemas"

export async function POST(req: Request): Promise<Response> {
  const authResult = await requireAdmin()
  if (authResult instanceof Response) return authResult
  const actorId = parseInt(authResult.id, 10)

  try {
    const { indentId, items } = await req.json()

    await prisma.$transaction(async (tx) => {
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)

      const receipt = await tx.receipt.create({
        data: { indentId, receivedDate: today, staffId: actorId },
      })

      for (const item of items) {
        if (!item.productSizeId) continue
        const totalBottles = item.casesReceived * (item.bottlesPerCase ?? 12) + item.bottlesReceived

        await tx.receiptItem.create({
          data: {
            receiptId: receipt.id,
            productSizeId: item.productSizeId,
            casesReceived: item.casesReceived,
            bottlesReceived: item.bottlesReceived,
            totalBottles,
          },
        })
      }

      await tx.indent.update({
        where: { id: indentId },
        data: { status: "STOCK_ADDED" },
      })

      await tx.auditEvent.create({
        data: {
          actorId,
          eventType: "INDENT_CONFIRMED",
          entity: "Indent",
          entityId: indentId,
          afterSnapshot: { receiptId: receipt.id },
        },
      })
    })

    return Response.json({ ok: true })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Receive failed", 500)
  }
}
