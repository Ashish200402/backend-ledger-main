const nodemailer = require("nodemailer")

const gmailAddress = "guptashish529@gmail.com"

function getEmailConfiguration() {
    return {
        configured: Boolean(process.env.SMTP_PASS),
        provider: "Gmail SMTP",
        address: gmailAddress,
        missing: process.env.SMTP_PASS ? [] : [ "SMTP_PASS" ]
    }
}

function createTransport() {
    const configuration = getEmailConfiguration()

    if (!configuration.configured) {
        throw new Error("Gmail SMTP is not configured. Set SMTP_PASS to a Gmail App Password in .env.")
    }

    const port = Number(process.env.SMTP_PORT || 465)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("SMTP_PORT must be a valid TCP port")
    }

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port,
        secure: process.env.SMTP_SECURE === "false" ? false : port === 465,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
        auth: {
            user: gmailAddress,
            pass: process.env.SMTP_PASS
        }
    })
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[ character ])
}

async function sendEmail(to, subject, text, html) {
    const transporter = createTransport()
    const info = await transporter.sendMail({
        from: `"Ledger" <${gmailAddress}>`,
        to,
        subject,
        text,
        html
    })

    if (!info.accepted || info.accepted.length === 0) {
        throw new Error("The email provider did not accept the message")
    }

    return {
        messageId: info.messageId,
        accepted: info.accepted
    }
}

function createRegistrationEmail(userEmail, name) {
    const safeName = escapeHtml(name)
    const subject = "Welcome to Ledger"
    const text = `Hello ${name},\n\nYour Ledger account is ready.`
    const html = `<p>Hello ${safeName},</p><p>Your Ledger account is ready.</p>`

    return { to: userEmail, subject, text, html }
}

function createTransactionEmail(userEmail, name, transaction, direction) {
    const safeName = escapeHtml(name)
    const safeDirection = escapeHtml(direction)
    const safeFrom = escapeHtml(transaction.fromAccount)
    const safeTo = escapeHtml(transaction.toAccount)
    const safeAmount = escapeHtml(
        new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(transaction.amount)
    )
    const subject = `Ledger transfer ${safeDirection.toLowerCase()}`
    const text = `Hello ${name},\n\n${safeDirection} ${safeAmount}.\nFrom account: ${transaction.fromAccount}\nTo account: ${transaction.toAccount}\nReference: ${transaction.id}`
    const html = `<p>Hello ${safeName},</p><p><strong>${safeDirection} ${safeAmount}</strong></p><p>From account: ${safeFrom}<br>To account: ${safeTo}<br>Reference: ${escapeHtml(transaction.id)}</p>`

    return { to: userEmail, subject, text, html }
}

async function sendRegistrationEmail(userEmail, name) {
    return sendMessage(createRegistrationEmail(userEmail, name))
}

async function sendTransactionEmail(userEmail, name, transaction, direction) {
    return sendMessage(createTransactionEmail(userEmail, name, transaction, direction))
}

async function sendTestEmail(userEmail, name) {
    const safeName = escapeHtml(name)
    const subject = "Your Ledger email is working"
    const text = `Hello ${name},\n\nThis test confirms that Ledger can send email to this address.`
    const html = `<p>Hello ${safeName},</p><p>This test confirms that Ledger can send email to this address.</p>`

    return sendMessage({ to: userEmail, subject, text, html })
}

async function sendMessage(message) {
    return sendEmail(message.to, message.subject, message.text, message.html)
}

async function sendTransactionFailureEmail(userEmail, name, amount, toAccount) {
    const safeName = escapeHtml(name)
    const safeTo = escapeHtml(toAccount)
    const safeAmount = escapeHtml(
        new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount)
    )
    const subject = "Ledger transfer failed"
    const text = `Hello ${name},\n\nYour transfer of ${safeAmount} to account ${toAccount} could not be completed.`
    const html = `<p>Hello ${safeName},</p><p>Your transfer of ${safeAmount} to account ${safeTo} could not be completed.</p>`

    return sendEmail(userEmail, subject, text, html)
}

module.exports = {
    getEmailConfiguration,
    createRegistrationEmail,
    createTransactionEmail,
    sendMessage,
    sendRegistrationEmail,
    sendTestEmail,
    sendTransactionEmail,
    sendTransactionFailureEmail
}
