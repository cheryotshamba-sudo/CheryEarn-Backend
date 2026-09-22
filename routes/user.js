const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();

// ===============================
// AUTHENTICATION MIDDLEWARE
// ===============================

function authenticateToken(req, res, next) {

    const authHeader =
        req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({
            success: false,
            message: "Authorization token is required."
        });
    }

    const parts =
        authHeader.split(" ");

    if (
        parts.length !== 2 ||
        parts[0] !== "Bearer"
    ) {
        return res.status(401).json({
            success: false,
            message: "Invalid authorization format."
        });
    }

    const token = parts[1];

    try {

        const decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );

        req.user = decoded;

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message: "Invalid or expired token."
        });

    }

}


// ===============================
// USER DASHBOARD
// ===============================

router.get(
    "/dashboard",
    authenticateToken,
    async (req, res) => {

        try {

            const userId =
                req.user.id;


            // ==========================================
            // GET USER
            // ==========================================

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        full_name,
                        username,
                        phone,
                        email,
                        account_status,
                        registration_paid,
                        referral_code,
                        referred_by,
                        cheryearn_number,
                        created_at
                    FROM users
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [userId]
                );


            if (result.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "User account not found."
                });

            }


            const user =
                result.rows[0];


            // ==========================================
            // COUNT DIRECT REFERRALS
            // ==========================================

            const referralResult =
                await pool.query(
                    `
                    SELECT COUNT(*) AS total
                    FROM users
                    WHERE referred_by = $1
                    `,
                    [userId]
                );


            const totalReferrals =
                Number(
                    referralResult.rows[0].total
                );


            // ==========================================
            // TOTAL CREDITED EARNINGS
            // ==========================================

            const earningsResult =
                await pool.query(
                    `
                    SELECT
                        COALESCE(
                            SUM(amount),
                            0
                        ) AS total
                    FROM commissions
                    WHERE recipient_user_id = $1
                      AND status = 'CREDITED'
                    `,
                    [userId]
                );


            const totalEarnings =
                Number(
                    earningsResult.rows[0].total
                );


            // ==========================================
            // PENDING EARNINGS
            // ==========================================

            const pendingResult =
                await pool.query(
                    `
                    SELECT
                        COALESCE(
                            SUM(amount),
                            0
                        ) AS total
                    FROM commissions
                    WHERE recipient_user_id = $1
                      AND status = 'PENDING'
                    `,
                    [userId]
                );


            const pendingEarnings =
                Number(
                    pendingResult.rows[0].total
                );


            // ==========================================
            // CURRENT BALANCE
            // ==========================================

            const balance =
                totalEarnings;


            // ==========================================
            // CHERYEARN DISPLAY NUMBER
            // ==========================================

            const cheryearnId =
                user.cheryearn_number
                    ? `CheryEarn${String(
                        user.cheryearn_number
                    ).padStart(3, "0")}`
                    : null;


            // ==========================================
            // DASHBOARD RESPONSE
            // ==========================================

            res.json({

                success: true,

                user: {

                    id:
                        user.id,

                    full_name:
                        user.full_name,

                    username:
                        user.username,

                    phone:
                        user.phone,

                    email:
                        user.email,

                    account_status:
                        user.account_status,

                    registration_paid:
                        user.registration_paid,

                    referral_code:
                        user.referral_code,

                    referred_by:
                        user.referred_by,

                    cheryearn_number:
                        user.cheryearn_number,

                    cheryearn_id:
                        cheryearnId,

                    created_at:
                        user.created_at,

                    balance:
                        balance,

                    totalEarnings:
                        totalEarnings,

                    pendingEarnings:
                        pendingEarnings,

                    totalReferrals:
                        totalReferrals

                }

            });

        } catch (error) {

            console.error(
                "Dashboard error:",
                error
            );

            res.status(500).json({
                success: false,
                message:
                    "Unable to load dashboard."
            });

        }

    }

);


module.exports = router;
