import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { CreateSupportTicketBody } from "@workspace/api-zod";
import { sendSupportTicketNotification } from "../lib/email";

const router: IRouter = Router();

router.post("/support/ticket", async (req, res): Promise<void> => {
  const parsed = CreateSupportTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const ticketId = `JS-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  const delivery = await sendSupportTicketNotification({
    ticketId,
    ...parsed.data,
  });
  if (!delivery.success) {
    req.log.error(
      { ticketId, error: delivery.error },
      "Support ticket notification could not be delivered",
    );
    res.status(503).json({
      error: "We could not deliver your request right now. Please try again shortly.",
    });
    return;
  }

  res.status(201).json({
    success: true,
    ticketId,
  });
});

export default router;