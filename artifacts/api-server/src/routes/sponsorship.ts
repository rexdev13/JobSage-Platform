import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { rolesTable, profilesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { assessSponsorshipFeasibility } from "../lib/sponsorshipFeasibility";

const router: IRouter = Router();

router.get("/sponsorship/feasibility/:roleId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const raw = Array.isArray(req.params.roleId) ? req.params.roleId[0] : req.params.roleId;
  const roleId = parseInt(raw, 10);
  if (isNaN(roleId)) {
    res.status(400).json({ error: "Invalid roleId." });
    return;
  }

  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, roleId));
  if (!role) {
    res.status(404).json({ error: "Role not found." });
    return;
  }

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, req.user!.id));

  const requiresSponsorship = profile?.requiresSponsorship ?? false;
  const result = assessSponsorshipFeasibility(role, requiresSponsorship);
  res.json(result);
});

export default router;
