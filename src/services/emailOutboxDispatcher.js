const emailOutboxModel = require("../models/emailOutbox.model")
const emailService = require("./email.service")

const POLL_INTERVAL_MS = 5000
const LOCK_DURATION_MS = 60_000
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000
let running = false
let timer

async function deliverNextEmail() {
    const now = new Date()
    const message = await emailOutboxModel.findOneAndUpdate(
        {
            $or: [
                { status: "PENDING", nextAttemptAt: { $lte: now } },
                { status: "SENDING", lockedUntil: { $lte: now } }
            ]
        },
        {
            $set: {
                status: "SENDING",
                lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS)
            }
        },
        {
            new: true,
            sort: { nextAttemptAt: 1, createdAt: 1 }
        }
    )

    if (!message) return false

    try {
        await emailService.sendMessage({
            to: message.to,
            subject: message.subject,
            text: message.text,
            html: message.html
        })

        await emailOutboxModel.updateOne(
            { _id: message._id, status: "SENDING" },
            {
                $set: {
                    status: "SENT",
                    sentAt: new Date()
                },
                $unset: {
                    lockedUntil: 1,
                    lastError: 1
                },
                $inc: {
                    attempts: 1
                }
            }
        )
        console.log(`Transaction email delivered for outbox ${message._id}`)
    } catch (error) {
        const attempts = message.attempts + 1
        const delay = Math.min(1000 * (2 ** Math.min(attempts, 12)), MAX_RETRY_DELAY_MS)
        const nextAttemptAt = new Date(Date.now() + delay)

        await emailOutboxModel.updateOne(
            { _id: message._id, status: "SENDING" },
            {
                $set: {
                    status: "PENDING",
                    nextAttemptAt,
                    lastError: String(error.message).slice(0, 500)
                },
                $unset: {
                    lockedUntil: 1
                },
                $inc: {
                    attempts: 1
                }
            }
        )
        console.error(
            `Transaction email delivery failed for outbox ${message._id}; retry scheduled at ${nextAttemptAt.toISOString()}:`,
            error.message
        )
    }

    return true
}

async function pollOutbox() {
    if (running) return
    running = true

    try {
        while (await deliverNextEmail()) {
            // Drain due messages before waiting for the next poll.
        }
    } catch (error) {
        console.error("Email outbox polling failed:", error.message)
    } finally {
        running = false
    }
}

function startEmailOutboxDispatcher() {
    if (timer) return
    timer = setInterval(pollOutbox, POLL_INTERVAL_MS)
    timer.unref()
    void pollOutbox()
}

module.exports = {
    startEmailOutboxDispatcher,
    pollOutbox
}
