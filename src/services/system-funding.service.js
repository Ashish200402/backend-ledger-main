const crypto = require("crypto")
const mongoose = require("mongoose")
const accountModel = require("../models/account.model")
const transactionModel = require("../models/transaction.model")
const ledgerModel = require("../models/ledger.model")
const userModel = require("../models/user.model")
const emailOutboxService = require("./emailOutbox.service")

function createServiceError(message, statusCode) {
    const error = new Error(message)
    error.statusCode = statusCode
    return error
}

async function getAccountBalance(accountId, session) {
    const [balanceData] = await ledgerModel.aggregate([
        { $match: { account: accountId } },
        {
            $group: {
                _id: null,
                balance: {
                    $sum: {
                        $cond: [
                            { $eq: [ "$type", "CREDIT" ] },
                            "$amount",
                            { $multiply: [ "$amount", -1 ] }
                        ]
                    }
                }
            }
        }
    ]).session(session)

    return balanceData ? balanceData.balance : 0
}

async function createFundedAccount(user, startingBalance) {
    const session = await mongoose.startSession()
    let createdAccount

    try {
        await session.withTransaction(async () => {
            const fundingAccount = await accountModel.findOne({
                kind: "SYSTEM_FUNDING",
                status: "ACTIVE"
            }).session(session)

            if (!fundingAccount) {
                throw createServiceError("The demo funding account is not set up yet", 503)
            }

            const systemUser = await userModel.findById(fundingAccount.user)
                .select("+systemUser")
                .session(session)

            if (!systemUser || !systemUser.systemUser) {
                throw new Error("Configured funding account is not owned by a system user")
            }

            if (startingBalance > 0) {
                const lockedFundingAccount = await accountModel.findOneAndUpdate(
                    { _id: fundingAccount._id, status: "ACTIVE" },
                    { $inc: { fundingRevision: 1 } },
                    { new: true, session }
                )

                if (!lockedFundingAccount) {
                    throw createServiceError("The demo funding account is not available", 503)
                }

                const availableBalance = await getAccountBalance(fundingAccount._id, session)
                if (availableBalance < startingBalance) {
                    throw createServiceError(
                        `The demo funding account has ${availableBalance.toFixed(2)} available`,
                        409
                    )
                }
            }

            const [account] = await accountModel.create([ {
                user: user._id,
                kind: "USER"
            } ], { session, ordered: true })
            createdAccount = account

            if (startingBalance > 0) {
                const [transaction] = await transactionModel.create([ {
                    fromAccount: fundingAccount._id,
                    toAccount: account._id,
                    amount: startingBalance,
                    idempotencyKey: crypto.randomUUID(),
                    status: "COMPLETED"
                } ], { session, ordered: true })

                await ledgerModel.create([ {
                    account: fundingAccount._id,
                    amount: startingBalance,
                    transaction: transaction._id,
                    type: "DEBIT"
                }, {
                    account: account._id,
                    amount: startingBalance,
                    transaction: transaction._id,
                    type: "CREDIT"
                } ], { session, ordered: true })

                await emailOutboxService.queueTransactionNotifications(transaction, session)
            }
        })
    } finally {
        await session.endSession()
    }

    return createdAccount
}

module.exports = {
    createFundedAccount
}
