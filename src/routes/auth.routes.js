const express = require("express")
const authController = require("../controllers/auth.controller")
const authMiddleware = require("../middleware/auth.middleware")

const router = express.Router()

router.get("/email/status", authMiddleware.authMiddleware, authController.getUserEmailStatusController)
router.post("/email/test", authMiddleware.authMiddleware, authController.sendTestEmailController)

/* POST /api/auth/register */
router.post("/register", authController.userRegisterController)


/* POST /api/auth/login */
router.post("/login",authController.userLoginController)

/**
 * - POST /api/auth/logout
 */
router.post("/logout", authController.userLogoutController)



module.exports = router