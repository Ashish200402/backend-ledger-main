const transactionModel = require("../models/transaction.model")
const ledgerModel = require("../models/ledger.model")
const accountModel = require("../models/account.model")
const emailOutboxModel = require("../models/emailOutbox.model")
const emailOutboxService = require("../services/emailOutbox.service")
const mongoose = require("mongoose")

async function getTransactionHistory(req, res) {
    const userAccounts = await accountModel.find({ user: req.user._id })
        .select("_id kind currency")
        .lean()
    const accountIds = userAccounts.map(account => account._id)

    if (accountIds.length === 0) {
        return res.status(200).json({ entries: [] })
    }

    const entries = await ledgerModel.find({ account: { $in: accountIds } })
        .sort({ _id: -1 })
        .populate({
            path: "transaction",
            select: "fromAccount toAccount amount status createdAt"
        })
        .lean()
    const relatedAccountIds = [
        ...new Set(entries.flatMap(entry => entry.transaction
            ? [ String(entry.transaction.fromAccount), String(entry.transaction.toAccount) ]
            : []))
    ]
    const relatedAccounts = await accountModel.find({ _id: { $in: relatedAccountIds } })
        .select("_id kind currency")
        .lean()
    const accountDetails = new Map(relatedAccounts.map(account => [ String(account._id), account ]))
    const transactionIds = entries
        .filter(entry => entry.transaction)
        .map(entry => entry.transaction._id)
    const emailStatuses = await emailOutboxModel.find({
        transaction: { $in: transactionIds },
        owner: req.user._id
    })
        .select("transaction direction status attempts nextAttemptAt lastError sentAt")
        .lean()
    const emailStatusByTransaction = new Map(
        emailStatuses.map(status => [ String(status.transaction), status ])
    )

    const history = entries
        .filter(entry => entry.transaction)
        .map(entry => {
            const transaction = entry.transaction
            const fromId = String(transaction.fromAccount)
            const toId = String(transaction.toAccount)
            const relatedEntryAccount = accountDetails.get(String(entry.account))

            return {
                id: String(entry._id),
                transactionId: String(transaction._id),
                type: entry.type,
                amount: entry.amount,
                status: transaction.status,
                emailDelivery: (() => {
                    const emailStatus = emailStatusByTransaction.get(String(transaction._id))
                    return emailStatus ? {
                        status: emailStatus.status,
                        direction: emailStatus.direction,
                        attempts: emailStatus.attempts,
                        nextAttemptAt: emailStatus.nextAttemptAt,
                        lastError: emailStatus.lastError,
                        sentAt: emailStatus.sentAt
                    } : null
                })(),
                createdAt: transaction.createdAt,
                currency: relatedEntryAccount ? relatedEntryAccount.currency : "INR",
                accountId: String(entry.account),
                accountKind: relatedEntryAccount ? relatedEntryAccount.kind : "USER",
                fromAccount: {
                    id: fromId,
                    kind: accountDetails.get(fromId)?.kind || "USER"
                },
                toAccount: {
                    id: toId,
                    kind: accountDetails.get(toId)?.kind || "USER"
                }
            }
        })
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))

    return res.status(200).json({ entries: history })
}

async function retryTransactionEmails(req, res) {
    if (!mongoose.isValidObjectId(req.params.transactionId)) {
        return res.status(400).json({ message: "Invalid transaction ID" })
    }

    const accountIds = await accountModel.find({ user: req.user._id }).distinct("_id")
    const transaction = await transactionModel.findOne({
        _id: req.params.transactionId,
        status: "COMPLETED",
        $or: [
            { fromAccount: { $in: accountIds } },
            { toAccount: { $in: accountIds } }
        ]
    })

    if (!transaction) {
        return res.status(404).json({ message: "Completed transaction not found" })
    }

    const queued = await emailOutboxService.retryTransactionNotifications(transaction)
    return res.status(202).json({
        message: queued > 0
            ? "Transaction email notification queued for delivery"
            : "There are no unsent transaction emails to retry",
        queued
    })
}

/**
 * - Create a new transaction
 * THE 10-STEP TRANSFER FLOW:
     * 1. Validate request
     * 2. Validate idempotency key
     * 3. Check account status
     * 4. Derive sender balance from ledger
     * 5. Create transaction (PENDING)
     * 6. Create DEBIT ledger entry
     * 7. Create CREDIT ledger entry
     * 8. Mark transaction COMPLETED
     * 9. Commit MongoDB session
     * 10. Queue email notifications atomically with the ledger entries
 */

async function createTransaction(req, res) {

    /**
     * 1. Validate request
     */
    const { fromAccount, toAccount, amount, idempotencyKey } = req.body

    if (!fromAccount || !toAccount || !amount || !idempotencyKey) {
        return res.status(400).json({
            message: "FromAccount, toAccount, amount and idempotencyKey are required"
        })
    }

    if (fromAccount === toAccount ||
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
        return res.status(400).json({
            message: "Choose two different accounts and enter a positive amount with at most two decimal places"
        })
    }

    const fromUserAccount = await accountModel.findOne({
        _id: fromAccount,
        user: req.user._id,
    })

    const toUserAccount = await accountModel.findOne({
        _id: toAccount,
        user: req.user._id,
    })

    if (!fromUserAccount || !toUserAccount) {
        return res.status(400).json({
            message: "Invalid fromAccount or toAccount"
        })
    }

    /**
     * 2. Validate idempotency key
     */

    const isTransactionAlreadyExists = await transactionModel.findOne({
        idempotencyKey: idempotencyKey
    })

    if (isTransactionAlreadyExists) {
        const sameRequest =
            String(isTransactionAlreadyExists.fromAccount) === String(fromAccount) &&
            String(isTransactionAlreadyExists.toAccount) === String(toAccount) &&
            isTransactionAlreadyExists.amount === amount

        if (!sameRequest) {
            return res.status(409).json({
                    message: "This idempotency key has already been used for a different transfer"
            })
        }

        if (isTransactionAlreadyExists.status === "COMPLETED") {
            const emailNotification = await emailOutboxModel.findOne({
                    transaction: isTransactionAlreadyExists._id,
                    owner: req.user._id
            }).select("status")

            return res.status(200).json({
                    message: "Transaction already processed",
                    transaction: isTransactionAlreadyExists,
                    emailNotifications: {
                        status: emailNotification ? emailNotification.status : "NOT_REQUIRED",
                        recipients: emailNotification ? 1 : 0
                    }
            })

        }

        if (isTransactionAlreadyExists.status === "PENDING") {
            return res.status(200).json({
                message: "Transaction is still processing",
            })
        }

        if (isTransactionAlreadyExists.status === "FAILED") {
            return res.status(500).json({
                message: "Transaction processing failed, please retry"
            })
        }

        if (isTransactionAlreadyExists.status === "REVERSED") {
            return res.status(500).json({
                message: "Transaction was reversed, please retry"
            })
        }
    }

    /**
     * 3. Check account status
     */

    if (fromUserAccount.status !== "ACTIVE" || toUserAccount.status !== "ACTIVE") {
        return res.status(400).json({
            message: "Both fromAccount and toAccount must be ACTIVE to process transaction"
        })
    }

    /**
     * 4. Derive sender balance from ledger
     */
    const balance = await fromUserAccount.getBalance()

    if (balance < amount) {
        return res.status(400).json({
            message: `Insufficient balance. Current balance is ${balance}. Requested amount is ${amount}`
        })
    }

    let transaction
    let emailRecipients = 0
    let session
    try {
        session = await mongoose.startSession()
        session.startTransaction()

        transaction = (await transactionModel.create([ {
            fromAccount,
            toAccount,
            amount,
            idempotencyKey,
            status: "PENDING"
        } ], { session, ordered: true }))[ 0 ]

        await ledgerModel.create([ {
            account: fromAccount,
            amount: amount,
            transaction: transaction._id,
            type: "DEBIT"
        } ], { session, ordered: true })

        await ledgerModel.create([ {
            account: toAccount,
            amount: amount,
            transaction: transaction._id,
            type: "CREDIT"
        } ], { session, ordered: true })

        await transactionModel.findOneAndUpdate(
            { _id: transaction._id },
            { status: "COMPLETED" },
            { session }
        )
        transaction.status = "COMPLETED"

        emailRecipients = await emailOutboxService.queueTransactionNotifications(transaction, session)
        await session.commitTransaction()
    } catch (error) {
        if (session && session.inTransaction()) {
            await session.abortTransaction()
        }
        console.error("Transaction failed and was rolled back:", error.message)
        return res.status(400).json({
            message: "Transaction is Pending due to some issue, please retry after sometime",
        })
    } finally {
        if (session) {
            await session.endSession()
        }
    }

    return res.status(201).json({
        message: "Transaction completed successfully",
        transaction: transaction,
        emailNotifications: {
            status: emailRecipients > 0 ? "QUEUED" : "NOT_REQUIRED",
            recipients: emailRecipients
        }
    })

}

async function createInitialFundsTransaction(req, res) {
    const { toAccount, amount, idempotencyKey } = req.body

    if (!toAccount || !idempotencyKey ||
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-8) {
        return res.status(400).json({
            message: "toAccount, idempotencyKey and a positive amount with at most two decimal places are required"
        })
    }

    const toUserAccount = await accountModel.findOne({
        _id: toAccount,
    })

    if (!toUserAccount) {
        return res.status(400).json({
            message: "Invalid toAccount"
        })
    }

    const fromUserAccount = await accountModel.findOne({
        user: req.user._id,
        kind: "SYSTEM_FUNDING"
    })

    if (!fromUserAccount) {
        return res.status(400).json({
            message: "System user account not found"
        })
    }


    const session = await mongoose.startSession()
    let transaction
    let emailRecipients = 0
    try {
        await session.withTransaction(async () => {
            [transaction] = await transactionModel.create([ {
                fromAccount: fromUserAccount._id,
                toAccount,
                amount,
                idempotencyKey,
                status: "PENDING"
            } ], { session, ordered: true })

            await ledgerModel.create([ {
                account: fromUserAccount._id,
                amount,
                transaction: transaction._id,
                type: "DEBIT"
            }, {
                account: toAccount,
                amount,
                transaction: transaction._id,
                type: "CREDIT"
            } ], { session, ordered: true })

            transaction.status = "COMPLETED"
            await transaction.save({ session })
            emailRecipients = await emailOutboxService.queueTransactionNotifications(transaction, session)
        })
    } finally {
        await session.endSession()
    }

    return res.status(201).json({
        message: "Initial funds transaction completed successfully",
        transaction: transaction,
        emailNotifications: {
            status: emailRecipients > 0 ? "QUEUED" : "NOT_REQUIRED",
            recipients: emailRecipients
        }
    })


}

module.exports = {
    getTransactionHistory,
    retryTransactionEmails,
    createTransaction,
    createInitialFundsTransaction
}
