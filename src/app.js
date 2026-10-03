const express = require("express")
const cookieParser = require("cookie-parser")
const path = require("path")
const mongoose = require("mongoose")



const app = express()

if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1)
}

app.use(express.json())
app.use(cookieParser())
app.use(express.static(path.join(__dirname, "../public")))
app.get("/health", (req, res) => {
    const isDatabaseReady = mongoose.connection.readyState === 1
    return res.status(isDatabaseReady ? 200 : 503).json({
        status: isDatabaseReady ? "ok" : "unavailable",
        database: isDatabaseReady ? "connected" : "disconnected"
    })
})

/**
 * - Routes required
 */
const authRouter = require("./routes/auth.routes")
const accountRouter = require("./routes/account.routes")
const transactionRoutes = require("./routes/transaction.routes")

/**
 * - Use Routes
 */

app.get("/", (req, res) => {
    res.send("Ledger Service is up and running")
})

app.use("/api/auth", authRouter)
app.use("/api/accounts", accountRouter)
app.use("/api/transactions", transactionRoutes)

module.exports = app