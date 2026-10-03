const mongoose = require("mongoose")

async function connectToDB() {
    const mongoUri = process.env.MONGO_URI

    if (!mongoUri) {
        throw new Error("MONGO_URI is not set. Configure it in your .env file.")
    }

    await mongoose.connect(mongoUri)
    console.log("Server is connected to MongoDB")
}

module.exports = connectToDB