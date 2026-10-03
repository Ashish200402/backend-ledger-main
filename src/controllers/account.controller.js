const accountModel = require("../models/account.model");
const systemFundingService = require("../services/system-funding.service")


async function createAccountController(req, res, next) {
    const startingBalance = req.body.startingBalance ?? 0

    if (typeof startingBalance !== "number" || !Number.isFinite(startingBalance) || startingBalance < 0) {
        return res.status(400).json({
            message: "Starting balance must be a non-negative number"
        })
    }

    if (Math.abs(startingBalance * 100 - Math.round(startingBalance * 100)) > 1e-8) {
        return res.status(400).json({
            message: "Starting balance cannot have more than two decimal places"
        })
    }

    try {
        const account = await systemFundingService.createFundedAccount(req.user, startingBalance)

        return res.status(201).json({
            account,
            startingBalance
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                message: error.message
            })
        }
        return next(error)
    }

}

async function getUserAccountsController(req, res) {

    const accounts = await accountModel.find({ user: req.user._id });

    res.status(200).json({
        accounts
    })
}

async function getAccountBalanceController(req, res) {
    const { accountId } = req.params;

    const account = await accountModel.findOne({
        _id: accountId,
        user: req.user._id
    })

    if (!account) {
        return res.status(404).json({
            message: "Account not found"
        })
    }

    const balance = await account.getBalance();

    res.status(200).json({
        accountId: account._id,
        balance: balance
    })
}


module.exports = {
    createAccountController,
    getUserAccountsController,
    getAccountBalanceController
}