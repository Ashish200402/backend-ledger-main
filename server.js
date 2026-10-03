require("dotenv").config()

const app = require("./src/app")
const connectToDB = require("./src/config/db")
const { startEmailOutboxDispatcher } = require("./src/services/emailOutboxDispatcher")

async function startServer() {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not set. Configure it in your .env file.")
    }

    await connectToDB()
    startEmailOutboxDispatcher()

    const port = process.env.PORT || 3000
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`)
    })
}

startServer().catch(error => {
    console.error("Failed to start server:", error.message)
    process.exitCode = 1
})