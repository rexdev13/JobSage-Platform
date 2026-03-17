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

export default router;
