const authView = document.querySelector("#auth-view")
const dashboardView = document.querySelector("#dashboard-view")
const authForm = document.querySelector("#auth-form")
const authNotice = document.querySelector("#auth-notice")
const transferNotice = document.querySelector("#transfer-notice")
const accountNotice = document.querySelector("#account-notice")
const emailStatusText = document.querySelector("#email-status-text")
const emailTestButton = document.querySelector("#send-test-email")
const nameField = document.querySelector("#name-field")
const logoutButton = document.querySelector("#logout-button")
const accountList = document.querySelector("#account-list")
const accountDialog = document.querySelector("#account-dialog")

let authMode = "login"
let accounts = []
let userName = sessionStorage.getItem("ledger-user-name") || ""
let ledgerRefreshTimer

function setNotice(element, message, isError = false) {
  element.textContent = message
  element.classList.toggle("error", isError)
  element.classList.remove("hidden")
}

function clearNotice(element) {
  element.textContent = ""
  element.classList.add("hidden")
  element.classList.remove("error")
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.message || "Something went wrong. Please try again.")
  }
  return data
}

function setAuthMode(mode) {
  authMode = mode
  const isRegister = mode === "register"
  document.querySelector("#login-tab").classList.toggle("active", !isRegister)
  document.querySelector("#register-tab").classList.toggle("active", isRegister)
  document.querySelector("#login-tab").setAttribute("aria-selected", String(!isRegister))
  document.querySelector("#register-tab").setAttribute("aria-selected", String(isRegister))
  nameField.classList.toggle("hidden", !isRegister)
  document.querySelector("#name").required = isRegister
  document.querySelector("#password").autocomplete = isRegister ? "new-password" : "current-password"
  document.querySelector("#auth-eyebrow").textContent = isRegister ? "A FRESH START" : "WELCOME BACK"
  document.querySelector("#auth-title").textContent = isRegister ? "Let's get you set up." : "Good to see you."
  document.querySelector("#auth-subtitle").textContent = isRegister
    ? "Create your account and bring things into balance."
    : "Sign in to pick up where you left off."
  document.querySelector("#auth-submit").innerHTML = isRegister
    ? 'Create account <span aria-hidden="true">→</span>'
    : 'Sign in <span aria-hidden="true">→</span>'
  clearNotice(authNotice)
}

function formatMoney(amount, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2
  }).format(Number(amount) || 0)
}

function displayAccountId(id) {
  return `•••• ${String(id).slice(-4)}`
}

function renderAccounts() {
  const total = accounts.reduce((sum, account) => sum + account.balance, 0)
  document.querySelector("#total-balance").textContent = formatMoney(total)
  document.querySelector("#account-count").textContent = `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"}`

  if (accounts.length === 0) {
    accountList.innerHTML = '<div class="empty-state"><strong>Your money starts here.</strong><p>Create your first account to see your balance and get started.</p></div>'
  } else {
    accountList.innerHTML = accounts.map((account, index) => `
      <article class="account-card">
        <div class="account-card-top">
          <span class="account-avatar" aria-hidden="true">${index % 2 === 0 ? "◈" : "◇"}</span>
          <span class="account-status"><span class="secure-dot"></span>${escapeHtml(account.status)}</span>
        </div>
        <h3>${index === 0 ? "Everyday account" : `Ledger account ${index + 1}`}</h3>
        <span class="account-id">${escapeHtml(displayAccountId(account._id))}</span>
        <div class="account-balance">${formatMoney(account.balance, account.currency)}</div>
        <span class="account-currency">${escapeHtml(account.currency)} account</span>
      </article>
    `).join("")
  }

  const options = accounts.map((account, index) =>
    `<option value="${escapeHtml(account._id)}">${escapeHtml(index === 0 ? "Everyday account" : `Ledger account ${index + 1}`)} · ${escapeHtml(displayAccountId(account._id))}</option>`
  ).join("")
  document.querySelector("#from-account").innerHTML = options || '<option value="">Create an account first</option>'
  document.querySelector("#to-account").innerHTML = options || '<option value="">Create an account first</option>'
  if (accounts.length > 1) {
    document.querySelector("#to-account").selectedIndex = 1
  }
  document.querySelector("#transfer-submit").disabled = accounts.length < 2
}

function formatAccount(accountId, kind = "USER") {
  if (kind === "SYSTEM_FUNDING") return "Demo funding reserve"
  if (kind === "SYSTEM_CAPITAL") return "System capital"
  return `Account ${displayAccountId(accountId)}`
}

function renderLedgerEntries(entries) {
  const entryList = document.querySelector("#ledger-entry-list")
  const emptyState = document.querySelector("#ledger-empty")

  emptyState.classList.toggle("hidden", entries.length > 0)
  entryList.innerHTML = entries.map(entry => {
    const direction = entry.type.toLowerCase()
    const amountPrefix = entry.type === "DEBIT" ? "−" : "+"
    const date = new Date(entry.createdAt)
    const formattedDate = Number.isNaN(date.getTime())
      ? "Date unavailable"
      : new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(date)

    return `
      <tr>
        <td class="ledger-date">${escapeHtml(formattedDate)}</td>
        <td><span class="ledger-direction ${direction}">${entry.type === "DEBIT" ? "↗" : "↙"} ${entry.type}</span><br><span class="account-id">${escapeHtml(formatAccount(entry.accountId, entry.accountKind))}</span></td>
        <td>${escapeHtml(formatAccount(entry.fromAccount.id, entry.fromAccount.kind))}</td>
        <td>${escapeHtml(formatAccount(entry.toAccount.id, entry.toAccount.kind))}</td>
        <td class="ledger-amount ${direction}">${amountPrefix}${formatMoney(entry.amount, entry.currency)}</td>
        <td><span class="ledger-status">${escapeHtml(entry.status)}</span></td>
        <td>${renderEmailDelivery(entry)}</td>
        <td class="ledger-reference" title="${escapeHtml(entry.transactionId)}">${escapeHtml(entry.transactionId.slice(-8))}</td>
      </tr>
    `
  }).join("")
}

function renderEmailDelivery(entry) {
  if (entry.emailDelivery && entry.emailDelivery.status === "SENT") {
    return '<span class="email-delivery-status sent">Sent</span>'
  }

  const status = !entry.emailDelivery
    ? "Not sent"
    : entry.emailDelivery.status === "SENDING"
      ? "Sending"
      : entry.emailDelivery.attempts > 0
        ? `Retrying (${entry.emailDelivery.attempts} attempts)`
        : "Queued"

  return `<span class="email-delivery-status ${entry.emailDelivery ? "failed" : ""}" title="${escapeHtml(entry.emailDelivery && entry.emailDelivery.lastError || "")}">${escapeHtml(status)}</span>
    <button class="retry-email-button" type="button" data-retry-transaction="${escapeHtml(entry.transactionId)}">Retry email</button>`
}

async function loadLedgerEntries() {
  const data = await api("/api/transactions")
  renderLedgerEntries(data.entries)
}

document.querySelector("#ledger-entry-list").addEventListener("click", async event => {
  const button = event.target.closest("[data-retry-transaction]")
  if (!button) return

  button.disabled = true
  button.textContent = "Queuing…"
  try {
    const result = await api(`/api/transactions/${encodeURIComponent(button.dataset.retryTransaction)}/email/retry`, {
      method: "POST",
      body: JSON.stringify({})
    })
    setNotice(transferNotice, result.message)
    await loadLedgerEntries()
  } catch (error) {
    setNotice(transferNotice, error.message, true)
    button.disabled = false
    button.textContent = "Retry email"
  }
})

async function loadEmailStatus() {
  try {
    const status = await api("/api/auth/email/status")
    if (status.configured) {
      emailStatusText.textContent = `${status.provider} is configured. Test delivery to ${status.address}.`
      emailTestButton.disabled = false
    } else {
      const missing = status.missing.join(", ")
      emailStatusText.textContent = `Email is not configured. Add ${missing} to .env and restart the server.`
      emailTestButton.disabled = true
    }
  } catch (error) {
    emailStatusText.textContent = error.message
    emailTestButton.disabled = true
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character])
}

function showDashboard() {
  authView.classList.add("hidden")
  dashboardView.classList.remove("hidden")
  logoutButton.classList.remove("hidden")
  document.querySelector("#welcome-title").textContent = userName ? `Welcome back, ${userName.split(" ")[0]}.` : "Welcome back."
  if (!ledgerRefreshTimer) {
    ledgerRefreshTimer = setInterval(async () => {
      if (dashboardView.classList.contains("hidden")) return
      try {
        await loadLedgerEntries()
      } catch (error) {
        setNotice(transferNotice, `Could not refresh email delivery status: ${error.message}`, true)
      }
    }, 10_000)
  }
}

async function loadAccounts() {
  const data = await api("/api/accounts")
  accounts = await Promise.all(data.accounts.map(async account => {
    const balanceData = await api(`/api/accounts/balance/${encodeURIComponent(account._id)}`)
    return { ...account, balance: balanceData.balance }
  }))
  renderAccounts()
}

async function enterDashboard(user) {
  if (user && user.name) {
    userName = user.name
    sessionStorage.setItem("ledger-user-name", userName)
  }
  await Promise.all([ loadAccounts(), loadLedgerEntries(), loadEmailStatus() ])
  showDashboard()
}

document.querySelector("#login-tab").addEventListener("click", () => setAuthMode("login"))
document.querySelector("#register-tab").addEventListener("click", () => setAuthMode("register"))

authForm.addEventListener("submit", async event => {
  event.preventDefault()
  clearNotice(authNotice)
  if (!authForm.reportValidity()) return
  const submitButton = document.querySelector("#auth-submit")
  submitButton.disabled = true
  submitButton.textContent = authMode === "register" ? "Creating account…" : "Signing in…"
  const payload = {
    email: document.querySelector("#email").value.trim(),
    password: document.querySelector("#password").value
  }
  if (authMode === "register") {
    payload.name = document.querySelector("#name").value.trim()
  }

  try {
    const data = await api(`/api/auth/${authMode === "register" ? "register" : "login"}`, {
      method: "POST",
      body: JSON.stringify(payload)
    })
    await enterDashboard(data.user)
  } catch (error) {
    setNotice(authNotice, error.message, true)
  } finally {
    submitButton.disabled = false
    submitButton.innerHTML = authMode === "register"
      ? 'Create account <span aria-hidden="true">→</span>'
      : 'Sign in <span aria-hidden="true">→</span>'
  }
})

document.querySelector("#add-account-button").addEventListener("click", () => {
  clearNotice(accountNotice)
  document.querySelector("#starting-balance").value = "0"
  accountDialog.showModal()
})

document.querySelector("#cancel-account-button").addEventListener("click", () => {
  accountDialog.close()
})

document.querySelector("#account-form").addEventListener("submit", async event => {
  event.preventDefault()
  clearNotice(accountNotice)
  const button = document.querySelector("#create-account-submit")
  const startingBalance = Number(document.querySelector("#starting-balance").value)
  if (!Number.isFinite(startingBalance) || startingBalance < 0) {
    setNotice(accountNotice, "Enter a starting balance of zero or more.", true)
    return
  }
  button.disabled = true
  button.textContent = "Creating account…"
  try {
    await api("/api/accounts", {
      method: "POST",
      body: JSON.stringify({ startingBalance })
    })
    await Promise.all([ loadAccounts(), loadLedgerEntries() ])
    accountDialog.close()
    setNotice(transferNotice, `Your account is ready with ${formatMoney(startingBalance)}.`)
  } catch (error) {
    setNotice(accountNotice, error.message, true)
  } finally {
    button.disabled = false
    button.textContent = "Create account"
  }
})

document.querySelector("#refresh-button").addEventListener("click", async event => {
  const button = event.currentTarget
  button.disabled = true
  try {
    await Promise.all([ loadAccounts(), loadLedgerEntries() ])
    setNotice(transferNotice, "Your balances are up to date.")
  } catch (error) {
    setNotice(transferNotice, error.message, true)
  } finally {
    button.disabled = false
  }
})

document.querySelector("#transfer-form").addEventListener("submit", async event => {
  event.preventDefault()
  clearNotice(transferNotice)
  const fromAccount = document.querySelector("#from-account").value
  const toAccount = document.querySelector("#to-account").value
  const amount = Number(document.querySelector("#amount").value)
  if (!fromAccount || !toAccount || fromAccount === toAccount) {
    setNotice(transferNotice, "Choose two different accounts to make a transfer.", true)
    return
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    setNotice(transferNotice, "Enter an amount greater than zero.", true)
    return
  }
  const button = document.querySelector("#transfer-submit")
  button.disabled = true
  button.textContent = "Processing transfer…"
  try {
    const result = await api("/api/transactions", {
      method: "POST",
      body: JSON.stringify({
        fromAccount,
        toAccount,
        amount,
        idempotencyKey: crypto.randomUUID()
      })
    })
    document.querySelector("#amount").value = ""
    await Promise.all([ loadAccounts(), loadLedgerEntries() ])
    const queuedEmails = result.emailNotifications && result.emailNotifications.recipients
    setNotice(
      transferNotice,
      queuedEmails
        ? "Transfer completed. Email notification queued for delivery."
        : "Transfer completed. Your balances have been updated."
    )
  } catch (error) {
    setNotice(transferNotice, error.message, true)
  } finally {
    button.disabled = accounts.length < 2
    button.innerHTML = 'Review transfer <span aria-hidden="true">→</span>'
  }
})

emailTestButton.addEventListener("click", async () => {
  emailTestButton.disabled = true
  emailTestButton.textContent = "Sending test…"
  try {
    const result = await api("/api/auth/email/test", { method: "POST", body: JSON.stringify({}) })
    emailStatusText.textContent = result.message
  } catch (error) {
    emailStatusText.textContent = error.message
  } finally {
    emailTestButton.disabled = false
    emailTestButton.textContent = "Send test email"
  }
})

logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" })
  } catch (error) {
    setNotice(transferNotice, error.message, true)
    return
  }
  sessionStorage.removeItem("ledger-user-name")
  clearInterval(ledgerRefreshTimer)
  ledgerRefreshTimer = undefined
  userName = ""
  accounts = []
  renderLedgerEntries([])
  emailStatusText.textContent = "Sign in to check email configuration."
  emailTestButton.disabled = true
  dashboardView.classList.add("hidden")
  authView.classList.remove("hidden")
  logoutButton.classList.add("hidden")
  setAuthMode("login")
  authForm.reset()
})
