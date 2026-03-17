import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import profileRouter from "./profiles";
import consentRouter from "./consent";
import documentsRouter from "./documents";
import eligibilityRouter from "./eligibility";
import rulesetsRouter from "./rulesets";
import rolesRouter from "./roles";
import sponsorshipRouter from "./sponsorship";
import remediationRouter from "./remediation";
import aiRouter from "./ai";
import reviewRouter from "./review";
import adminAuditRouter from "./adminAudit";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(profileRouter);
router.use(consentRouter);
router.use(documentsRouter);
router.use(eligibilityRouter);
router.use(rulesetsRouter);
router.use(rolesRouter);
router.use(sponsorshipRouter);
router.use(remediationRouter);
router.use(aiRouter);
router.use(reviewRouter);
router.use(adminAuditRouter);

export default router;
