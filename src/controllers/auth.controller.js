const userModel = require("../models/user.model")
const jwt = require("jsonwebtoken")
const emailService = require("../services/email.service")
const emailOutboxService = require("../services/emailOutbox.service")
const tokenBlackListModel = require("../models/blackList.model")
const mongoose = require("mongoose")

function setAuthCookie(res, token) {
    res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 3 * 24 * 60 * 60 * 1000
    })
}

/**
* - user register controller
* - POST /api/auth/register
*/
async function userRegisterController(req, res) {
    const { email, password, name } = req.body

    const isExists = await userModel.findOne({
        email: email
    })

    if (isExists) {
        return res.status(422).json({
            message: "User already exists with email.",
            status: "failed"
        })
    }

    const session = await mongoose.startSession()
    let user
    try {
        await session.withTransaction(async () => {
            [user] = await userModel.create([ {
                email,
                password,
                name
            } ], { session, ordered: true })
            await emailOutboxService.queueRegistrationEmail(user, session)
        })
    } finally {
        await session.endSession()
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "3d" })

    setAuthCookie(res, token)

    res.status(201).json({
        user: {
            _id: user._id,
            email: user.email,
            name: user.name
        },
        token,
        emailNotification: {
            status: "QUEUED"
        }
    })

}

/**
 * - User Login Controller
 * - POST /api/auth/login
  */

async function userLoginController(req, res) {
    const { email, password } = req.body

    const user = await userModel.findOne({ email }).select("+password")

    if (!user) {
        return res.status(401).json({
            message: "Email or password is INVALID"
        })
    }

    const isValidPassword = await user.comparePassword(password)

    if (!isValidPassword) {
        return res.status(401).json({
            message: "Email or password is INVALID"
        })
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "3d" })

    setAuthCookie(res, token)

    res.status(200).json({
        user: {
            _id: user._id,
            email: user.email,
            name: user.name
        },
        token
    })

}

function getUserEmailStatusController(req, res) {
    const configuration = emailService.getEmailConfiguration()
    return res.status(200).json({
        ...configuration,
        address: req.user.email
    })
}

async function sendTestEmailController(req, res) {
    try {
        await emailService.sendTestEmail(req.user.email, req.user.name)
        return res.status(200).json({
            sent: true,
            message: `Test email sent to ${req.user.email}`
        })
    } catch (error) {
        console.error("Test email could not be sent:", error.message)
        return res.status(503).json({
            sent: false,
            message: error.message
        })
    }
}


/**
 * - User Logout Controller
 * - POST /api/auth/logout
  */
async function userLogoutController(req, res) {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[ 1 ]

    if (!token) {
        return res.status(200).json({
            message: "User logged out successfully"
        })
    }



    await tokenBlackListModel.create({
        token: token
    })

    res.clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax"
    })

    res.status(200).json({
        message: "User logged out successfully"
    })

}


module.exports = {
    userRegisterController,
    userLoginController,
    getUserEmailStatusController,
    sendTestEmailController,
    userLogoutController
}