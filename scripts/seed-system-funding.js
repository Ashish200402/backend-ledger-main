require("dotenv").config()

const crypto = require("crypto")
const mongoose = require("mongoose")
const connectToDB = require("../src/config/db")
const userModel = require("../src/models/user.model")
const accountModel = require("../src/models/account.model")
const transactionModel = require("../src/models/transaction.model")
const ledgerModel = require("../src/models/ledger.model")

async function seedSystemFunding() {
    const reserveAmount = Number(process.env.SYSTEM_INITIAL_RESERVE || 50000)
    if (!Number.isFinite(reserveAmount) || reserveAmount <= 0 ||
        Math.abs(reserveAmount * 100 - Math.round(reserveAmount * 100)) > 1e-8) {
        throw new Error("SYSTEM_INITIAL_RESERVE must be a positive amount with at most two decimal places")
    }

    const email = process.env.SYSTEM_USER_EMAIL || "system@backend-ledger.local"
    let systemUser = await userModel.findOne({ email }).select("+systemUser")

    if (!systemUser) {
        systemUser = await userModel.create({
            email,
            name: "Ledger System",
            password: crypto.randomBytes(32).toString("hex"),
            systemUser: true
        })
    } else if (!systemUser.systemUser) {
        throw new Error(`SYSTEM_USER_EMAIL ${email} belongs to a non-system user`)
    }

    let fundingAccount = await accountModel.findOne({
        user: systemUser._id,
        kind: "SYSTEM_FUNDING"
    })
    let capitalAccount = await accountModel.findOne({
        user: systemUser._id,
        kind: "SYSTEM_CAPITAL"
    })

    if (!fundingAccount || !capitalAccount) {
        const session = await mongoose.startSession()
        try {
            await session.withTransaction(async () => {
                if (!fundingAccount) {
                    [fundingAccount] = await accountModel.create([ {
                        user: systemUser._id,
                        kind: "SYSTEM_FUNDING"
                    } ], { session, ordered: true })
                }
                if (!capitalAccount) {
                    [capitalAccount] = await accountModel.create([ {
                        user: systemUser._id,
                        kind: "SYSTEM_CAPITAL"
                    } ], { session, ordered: true })
                }
            })
        } finally {
            await session.endSession()
        }
    }

    const idempotencyKey = "system-opening-capital-v1"
    const existingSeed = await transactionModel.findOne({ idempotencyKey })
    if (existingSeed) {
        console.log("System funding reserve has already been seeded")
        return
    }

    const session = await mongoose.startSession()
    try {
        await session.withTransaction(async () => {
            const [transaction] = await transactionModel.create([ {
                fromAccount: capitalAccount._id,
                toAccount: fundingAccount._id,
                amount: reserveAmount,
                idempotencyKey,
                status: "COMPLETED"
            } ], { session, ordered: true })

            await ledgerModel.create([ {
                account: capitalAccount._id,
                amount: reserveAmount,
                transaction: transaction._id,
                type: "DEBIT"
            }, {
                account: fundingAccount._id,
                amount: reserveAmount,
                transaction: transaction._id,
                type: "CREDIT"
            } ], { session, ordered: true })
        })
    } finally {
        await session.endSession()
    }

    console.log(`Seeded demo system funding reserve with INR ${reserveAmount.toFixed(2)}`)
}

connectToDB()
    .then(seedSystemFunding)
    .catch(error => {
        console.error("Failed to seed system funding account:", error.message)
        process.exitCode = 1
    })
    .finally(() => mongoose.disconnect())
