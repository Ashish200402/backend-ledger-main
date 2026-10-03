const mongoose = require("mongoose")

const emailOutboxSchema = new mongoose.Schema({
    eventKey: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    owner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true,
        index: true
    },
    transaction: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "transaction",
        index: true
    },
    to: {
        type: String,
        required: true
    },
    subject: {
        type: String,
        required: true
    },
    text: {
        type: String,
        required: true
    },
    html: {
        type: String,
        required: true
    },
    direction: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: [ "PENDING", "SENDING", "SENT" ],
        default: "PENDING",
        index: true
    },
    attempts: {
        type: Number,
        default: 0
    },
    nextAttemptAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    lockedUntil: {
        type: Date
    },
    sentAt: {
        type: Date
    },
    lastError: {
        type: String
    }
}, {
    timestamps: true
})

emailOutboxSchema.index({ status: 1, nextAttemptAt: 1, lockedUntil: 1 })

module.exports = mongoose.model("emailOutbox", emailOutboxSchema)
