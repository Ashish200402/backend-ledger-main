const emailOutboxModel = require("../models/emailOutbox.model")
const emailService = require("./email.service")

async function queueRegistrationEmail(user, session) {
    const message = {
        eventKey: `registration:${user._id}`,
        owner: user._id,
        direction: "WELCOME",
        ...emailService.createRegistrationEmail(user.email, user.name)
    }

    await emailOutboxModel.create([ message ], {
        ...(session ? { session } : {}),
        ordered: true
    })
}

async function buildTransactionNotifications(transaction, session = null) {
    const accountModel = require("../models/account.model")
    const relatedAccounts = await accountModel.find({
        _id: { $in: [ transaction.fromAccount, transaction.toAccount ] }
    })
        .select("user")
        .populate({
            path: "user",
            select: "name email +systemUser"
        })
        .session(session)
        .lean()

    const recipients = new Map()
    for (const account of relatedAccounts) {
        const recipient = account.user
        if (!recipient || recipient.systemUser) continue

        const direction = String(account._id) === String(transaction.fromAccount)
            ? "DEBIT"
            : "CREDIT"
        const existing = recipients.get(String(recipient._id))

        if (existing) {
            if (!existing.directions.includes(direction)) {
                existing.directions.push(direction)
            }
        } else {
            recipients.set(String(recipient._id), {
                user: recipient,
                directions: [ direction ]
            })
        }
    }

    const details = {
        id: String(transaction._id),
        amount: transaction.amount,
        fromAccount: String(transaction.fromAccount),
        toAccount: String(transaction.toAccount)
    }
    const messages = Array.from(recipients.entries(), ([ userId, recipient ]) => {
        const direction = recipient.directions.join(" and ")
        return {
            eventKey: `transaction:${transaction._id}:user:${userId}`,
            owner: recipient.user._id,
            transaction: transaction._id,
            direction,
            ...emailService.createTransactionEmail(
                recipient.user.email,
                recipient.user.name,
                details,
                direction
            )
        }
    })

    return messages
}

async function queueTransactionNotifications(transaction, session) {
    const messages = await buildTransactionNotifications(transaction, session)

    if (messages.length > 0) {
        await emailOutboxModel.insertMany(messages, {
            ...(session ? { session } : {}),
            ordered: true
        })
    }

    return messages.length
}

async function retryTransactionNotifications(transaction) {
    const messages = await buildTransactionNotifications(transaction)
    let queued = 0

    for (const message of messages) {
        const existing = await emailOutboxModel.findOne({ eventKey: message.eventKey })

        if (existing && existing.status === "SENT") continue
        if (existing && existing.status === "SENDING") continue

        if (existing) {
            existing.status = "PENDING"
            existing.nextAttemptAt = new Date()
            existing.lastError = undefined
            await existing.save()
        } else {
            try {
                await emailOutboxModel.create(message)
            } catch (error) {
                if (error.code !== 11000) throw error
            }
        }
        queued += 1
    }

    return queued
}

module.exports = {
    queueRegistrationEmail,
    queueTransactionNotifications,
    retryTransactionNotifications
}
