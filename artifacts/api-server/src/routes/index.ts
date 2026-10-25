import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workspaceRouter from "./workspace";
import publicCareRouter from "./public-care";
import requestsRouter from "./requests";
import appointmentsRouter from "./appointments";
import tasksQrRouter from "./tasks-qr";
import reportsRouter from "./reports";
import financeRouter from "./finance";
import settingsPlatformRouter from "./settings-platform";
import teamRouter from "./team";
import platformRouter from "./platform";
import modulesRouter from "./modules";
import messagesRouter from "./messages";

const router: IRouter = Router();

router.use(healthRouter);
router.use(workspaceRouter);
router.use(publicCareRouter);
router.use(requestsRouter);
router.use(appointmentsRouter);
router.use(tasksQrRouter);
router.use(reportsRouter);
router.use(financeRouter);
router.use(settingsPlatformRouter);
router.use(teamRouter);
router.use(platformRouter);
router.use(modulesRouter);
router.use(messagesRouter);

export default router;
