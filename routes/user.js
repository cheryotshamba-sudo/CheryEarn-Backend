const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const router = express.Router();


// ===============================
// AUTHENTICATION MIDDLEWARE
// ===============================

function authenticateToken(req, res, next) {

    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({
            success: false,
            message: "Authorization token is required."
        });
    }

    const parts = authHeader.split(" ");

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

        const decoded = jwt.verify(
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
// SAFE GATEWAY RESPONSE PARSER
// ===============================

function parseGatewayResponse(value) {

    if (!value) {
        return {};
    }

    if (typeof value === "object") {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return {};
    }
}


// ===============================
// FIND TRANSACTION CODE
// ===============================

function getTransactionCode(
    gatewayResponse,
    paymentReference
) {

    const data =
        parseGatewayResponse(gatewayResponse);

    const possibleKeys = [

        "transactionId",
        "transaction_id",

        "transactionCode",
        "transaction_code",

        "trxId",
        "trx_id",

        "transaction",

        "receipt",
        "receiptNumber",
        "receipt_number",

        "mpesaReceiptNumber",
        "mpesa_receipt_number",

        "checkoutRequestId",
        "checkout_request_id",

        "merchantRequestId",
        "merchant_request_id",

        "reference",

        "id"

    ];

    for (const key of possibleKeys) {

        if (
            data &&
            data[key] !== undefined &&
            data[key] !== null &&
            String(data[key]).trim() !== ""
        ) {

            return String(data[key]);
        }
    }

    const nestedObjects = [

        data.data,
        data.payment,
        data.transaction,
        data.result,
        data.response

    ];

    for (const nested of nestedObjects) {

        if (
            nested &&
            typeof nested === "object"
        ) {

            for (const key of possibleKeys) {

                if (
                    nested[key] !== undefined &&
                    nested[key] !== null &&
                    String(nested[key]).trim() !== ""
                ) {

                    return String(nested[key]);
                }
            }
        }
    }

    return paymentReference || "N/A";
}


// ===============================
// CREATE CHERYEARN DISPLAY NUMBER
// ===============================

function formatCheryEarnNumber(number) {

    if (
        number === null ||
        number === undefined
    ) {
        return null;
    }

    return `CheryEarn${String(number).padStart(3, "0")}`;
}


// ===============================
// CREATE REFERRAL LINK
// ===============================

function createReferralLink(
    cheryearnNumber,
    username
) {

    if (
        cheryearnNumber === null ||
        cheryearnNumber === undefined
    ) {
        return "";
    }

    if (
        !username ||
        String(username).trim() === ""
    ) {
        return "";
    }

    const cheryearnId =
        formatCheryEarnNumber(cheryearnNumber);

    const cleanUsername =
        String(username)
            .trim()
            .replace(/\s+/g, "")
            .replace(/[^a-zA-Z0-9_.-]/g, "");

    if (
        !cheryearnId ||
        !cleanUsername
    ) {
        return "";
    }

    const member =
        `${cheryearnId}-${cleanUsername}`;

    return (
        "https://cheryearn1.onrender.com/register.html?member=" +
        encodeURIComponent(member)
    );
}


// ===============================
// USER DASHBOARD
// ===============================

router.get(
    "/dashboard",
    authenticateToken,
    async (req, res) => {

        try {

            const userId = req.user.id;


            // ==========================================
            // GET CURRENT USER
            // ==========================================

            const result = await pool.query(
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


            const user = result.rows[0];


            // ==========================================
            // CREATE CHERYEARN ID
            // ==========================================

            const cheryearnId =
                formatCheryEarnNumber(
                    user.cheryearn_number
                );


            // ==========================================
            // CREATE REFERRAL LINK
            // ==========================================

            const referralLink =
                createReferralLink(
                    user.cheryearn_number,
                    user.username
                );


            // ==========================================
            // DIRECT REFERRALS
            // ==========================================

            const directResult = await pool.query(
                `
                SELECT
                    u.id,
                    u.full_name,
                    u.phone,
                    u.cheryearn_number,
                    u.created_at,

                    rp.id AS payment_id,
                    rp.amount,
                    rp.status AS payment_status,
                    rp.payment_reference,
                    rp.gateway_response,
                    rp.created_at AS payment_created_at,
                    rp.completed_at,

                    c.amount AS commission,
                    c.level AS commission_level,
                    c.status AS commission_status

                FROM users u

                LEFT JOIN registration_payments rp
                    ON rp.user_id = u.id

                LEFT JOIN commissions c
                    ON c.payment_id = rp.id
                    AND c.recipient_user_id = $1
                    AND c.level = 1

                WHERE u.referred_by = $1

                ORDER BY
                    COALESCE(
                        rp.completed_at,
                        rp.created_at,
                        u.created_at
                    ) DESC
                `,
                [userId]
            );


            // ==========================================
            // GET DIRECT USER IDS
            // ==========================================

            const directIds =
                directResult.rows.map(
                    row => row.id
                );


            // ==========================================
            // INDIRECT REFERRALS
            // ==========================================

            let indirectResult = {
                rows: []
            };


            if (directIds.length > 0) {

                indirectResult =
                    await pool.query(
                        `
                        SELECT
                            u.id,
                            u.full_name,
                            u.phone,
                            u.cheryearn_number,
                            u.created_at,

                            rp.id AS payment_id,
                            rp.amount,
                            rp.status AS payment_status,
                            rp.payment_reference,
                            rp.gateway_response,
                            rp.created_at AS payment_created_at,
                            rp.completed_at,

                            c.amount AS commission,
                            c.level AS commission_level,
                            c.status AS commission_status

                        FROM users u

                        LEFT JOIN registration_payments rp
                            ON rp.user_id = u.id

                        LEFT JOIN commissions c
                            ON c.payment_id = rp.id
                            AND c.recipient_user_id = $1
                            AND c.level = 2

                        WHERE u.referred_by IN (
                            SELECT id
                            FROM users
                            WHERE referred_by = $1
                        )

                        ORDER BY
                            COALESCE(
                                rp.completed_at,
                                rp.created_at,
                                u.created_at
                            ) DESC
                        `,
                        [userId]
                    );

            }


            // ==========================================
            // FORMAT DIRECT REFERRALS
            // ==========================================

            const directReferrals =
                directResult.rows.map(row => {

                    const transactionCode =
                        getTransactionCode(
                            row.gateway_response,
                            row.payment_reference
                        );

                    return {

                        userId:
                            row.id,

                        fullName:
                            row.full_name,

                        cheryearnNumber:
                            formatCheryEarnNumber(
                                row.cheryearn_number
                            ),

                        phone:
                            row.phone,

                        amountPaid:
                            row.amount !== null
                                ? Number(row.amount)
                                : 0,

                        paymentStatus:
                            row.payment_status ||
                            "NOT PAID",

                        paymentTime:
                            row.completed_at ||
                            row.payment_created_at ||
                            row.created_at ||
                            null,

                        transactionCode:
                            transactionCode,

                        level:
                            "Direct",

                        commission:
                            row.commission !== null
                                ? Number(row.commission)
                                : 0,

                        commissionStatus:
                            row.commission_status ||
                            null

                    };

                });


            // ==========================================
            // FORMAT INDIRECT REFERRALS
            // ==========================================

            const indirectReferrals =
                indirectResult.rows.map(row => {

                    const transactionCode =
                        getTransactionCode(
                            row.gateway_response,
                            row.payment_reference
                        );

                    return {

                        userId:
                            row.id,

                        fullName:
                            row.full_name,

                        cheryearnNumber:
                            formatCheryEarnNumber(
                                row.cheryearn_number
                            ),

                        phone:
                            row.phone,

                        amountPaid:
                            row.amount !== null
                                ? Number(row.amount)
                                : 0,

                        paymentStatus:
                            row.payment_status ||
                            "NOT PAID",

                        paymentTime:
                            row.completed_at ||
                            row.payment_created_at ||
                            row.created_at ||
                            null,

                        transactionCode:
                            transactionCode,

                        level:
                            "Indirect",

                        commission:
                            row.commission !== null
                                ? Number(row.commission)
                                : 0,

                        commissionStatus:
                            row.commission_status ||
                            null

                    };

                });


            // ==========================================
            // TOTAL REFERRALS
            // ==========================================

            const totalDirectReferrals =
                directReferrals.length;

            const totalIndirectReferrals =
                indirectReferrals.length;

            const totalReferrals =
                totalDirectReferrals +
                totalIndirectReferrals;


            // ==========================================
            // DIRECT EARNINGS
            // ==========================================

            const directEarningsResult =
                await pool.query(
                    `
                    SELECT
                        COALESCE(
                            SUM(amount),
                            0
                        ) AS total
                    FROM commissions
                    WHERE recipient_user_id = $1
                      AND level = 1
                      AND status = 'CREDITED'
                    `,
                    [userId]
                );


            const directEarnings =
                Number(
                    directEarningsResult.rows[0].total
                );


            // ==========================================
            // INDIRECT EARNINGS
            // ==========================================

            const indirectEarningsResult =
                await pool.query(
                    `
                    SELECT
                        COALESCE(
                            SUM(amount),
                            0
                        ) AS total
                    FROM commissions
                    WHERE recipient_user_id = $1
                      AND level = 2
                      AND status = 'CREDITED'
                    `,
                    [userId]
                );


            const indirectEarnings =
                Number(
                    indirectEarningsResult.rows[0].total
                );


            // ==========================================
            // TOTAL EARNINGS
            // ==========================================

            const totalEarnings =
                directEarnings +
                indirectEarnings;


            // ==========================================
            // CURRENT BALANCE
            // ==========================================

            const balance =
                totalEarnings;


            // ==========================================
            // RECENT ACTIVITY
            // ==========================================

            const activityResult =
                await pool.query(
                    `
                    SELECT
                        rp.id,
                        rp.user_id,
                        rp.amount,
                        rp.status,
                        rp.payment_reference,
                        rp.phone,
                        rp.gateway_response,
                        rp.created_at,
                        rp.completed_at,

                        u.full_name,
                        u.cheryearn_number

                    FROM registration_payments rp

                    INNER JOIN users u
                        ON u.id = rp.user_id

                    WHERE
                        u.referred_by = $1

                        OR

                        u.referred_by IN (
                            SELECT id
                            FROM users
                            WHERE referred_by = $1
                        )

                    ORDER BY
                        COALESCE(
                            rp.completed_at,
                            rp.created_at
                        ) DESC

                    LIMIT 20
                    `,
                    [userId]
                );


            const recentActivity =
                activityResult.rows.map(row => {

                    const isDirect =
                        directIds.includes(
                            row.user_id
                        );

                    const transactionCode =
                        getTransactionCode(
                            row.gateway_response,
                            row.payment_reference
                        );

                    return {

                        paymentId:
                            row.id,

                        cheryearnNumber:
                            formatCheryEarnNumber(
                                row.cheryearn_number
                            ),

                        fullName:
                            row.full_name,

                        phone:
                            row.phone,

                        amount:
                            Number(row.amount || 0),

                        status:
                            row.status,

                        transactionCode:
                            transactionCode,

                        paymentReference:
                            row.payment_reference,

                        paymentTime:
                            row.completed_at ||
                            row.created_at ||
                            null,

                        level:
                            isDirect
                                ? "Direct"
                                : "Indirect"

                    };

                });


            // ==========================================
            // FINAL DASHBOARD RESPONSE
            // ==========================================

            return res.json({

                success: true,

                balance:
                    balance,

                availableBalance:
                    balance,

                totalEarnings:
                    totalEarnings,

                directEarnings:
                    directEarnings,

                indirectEarnings:
                    indirectEarnings,

                referralLink:
                    referralLink,

                referralCode:
                    user.referral_code,

                cheryearnNumber:
                    user.cheryearn_number,

                cheryearnId:
                    cheryearnId,

                username:
                    user.username,

                totalReferrals:
                    totalReferrals,

                directReferrals:
                    directReferrals,

                indirectReferrals:
                    indirectReferrals,

                recentActivity:
                    recentActivity,


                // ======================================
                // USER OBJECT
                // ======================================

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

                    referralLink:
                        referralLink,

                    balance:
                        balance,

                    availableBalance:
                        balance,

                    totalEarnings:
                        totalEarnings,

                    directEarnings:
                        directEarnings,

                    indirectEarnings:
                        indirectEarnings,

                    totalReferrals:
                        totalReferrals,

                    created_at:
                        user.created_at

                }

            });

        } catch (error) {

            console.error(
                "Dashboard error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Unable to load dashboard.",

                error:
                    process.env.NODE_ENV === "production"
                        ? undefined
                        : error.message

            });

        }

    }

);


// =====================================================
// REFERRALS PAGE
// =====================================================
// This endpoint is specifically used by referrals.html.
// It returns both DIRECT and INDIRECT referrals.
// =====================================================

router.get(
    "/referrals",
    authenticateToken,
    async (req, res) => {

        try {

            const userId = req.user.id;


            // ==========================================
            // CHECK CURRENT USER
            // ==========================================

            const userResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        full_name,
                        username,
                        cheryearn_number,
                        referral_code
                    FROM users
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [userId]
                );


            if (userResult.rows.length === 0) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User account not found."

                });

            }


            const currentUser =
                userResult.rows[0];


            // ==========================================
            // DIRECT REFERRALS
            // ==========================================

            const directResult =
                await pool.query(
                    `
                    SELECT
                        u.id,
                        u.full_name,
                        u.phone,
                        u.cheryearn_number,
                        u.created_at,

                        rp.amount,
                        rp.status AS payment_status,
                        rp.payment_reference,
                        rp.gateway_response,
                        rp.created_at AS payment_created_at,
                        rp.completed_at,

                        c.amount AS commission,
                        c.status AS commission_status

                    FROM users u

                    LEFT JOIN registration_payments rp
                        ON rp.user_id = u.id

                    LEFT JOIN commissions c
                        ON c.payment_id = rp.id
                        AND c.recipient_user_id = $1
                        AND c.level = 1

                    WHERE u.referred_by = $1

                    ORDER BY
                        u.created_at DESC
                    `,
                    [userId]
                );


            // ==========================================
            // INDIRECT REFERRALS
            // ==========================================

            const indirectResult =
                await pool.query(
                    `
                    SELECT
                        u.id,
                        u.full_name,
                        u.phone,
                        u.cheryearn_number,
                        u.created_at,

                        rp.amount,
                        rp.status AS payment_status,
                        rp.payment_reference,
                        rp.gateway_response,
                        rp.created_at AS payment_created_at,
                        rp.completed_at,

                        c.amount AS commission,
                        c.status AS commission_status

                    FROM users u

                    LEFT JOIN registration_payments rp
                        ON rp.user_id = u.id

                    LEFT JOIN commissions c
                        ON c.payment_id = rp.id
                        AND c.recipient_user_id = $1
                        AND c.level = 2

                    WHERE u.referred_by IN (
                        SELECT id
                        FROM users
                        WHERE referred_by = $1
                    )

                    ORDER BY
                        u.created_at DESC
                    `,
                    [userId]
                );


            // ==========================================
            // FORMAT DIRECT REFERRALS
            // ==========================================

            const directReferrals =
                directResult.rows.map(row => {

                    return {

                        userId:
                            row.id,

                        fullName:
                            row.full_name,

                        name:
                            row.full_name,

                        full_name:
                            row.full_name,

                        cheryearnNumber:
                            formatCheryEarnNumber(
                                row.cheryearn_number
                            ),

                        cheryearn_number:
                            formatCheryEarnNumber(
                                row.cheryearn_number
                            ),

                        phone:
                            row.phone,

                        amountPaid:
                            row.amount !== null
                                ? Number(row.amount)
                                : 0,

                        amount:
                            row.amount !== null
                                ? Number(row.amount)
                                : 0,

                        paymentStatus:
                            row.payment_status ||
                            "NOT PAID",

                        paymentTime:
                            row.completed_at ||
                            row.payment_created_at ||
                            row.created_at ||
                            null,

                        createdAt:
                            row.created_at,

                        transactionCode:
                            getTransactionCode(
                                row.gateway_response,
                                row.payment_reference
                            ),

                        level:
                            "Direct",

                        commission:
                            row.commission !== null
                                ? Number(row.commission)
                                : 0,

                        earning:
                            row.commission !== null
                                ? Number(row.commission)
                                : 0,

                        commissionStatus:
                            row.commission_status ||
                            null

                    };

                });


            // ==========================================
            // FORMAT INDIRECT REFERRALS
            // ==========================================

            const indirectReferrals =
                indirectResult.rows.map(row => {

                    return {

                        userId:
                            row.id,

                        fullName:
                            row.full_name,

                        name:
                            row.full_name,

                        full_name:
                            row.full_name,

                        cheryearnNumber:
                            formatCheryEarnNumber(
                                row.cheryearn_number
                            ),

                        cheryearn_number:
                            formatCheryEarnNumber(
                                row.cheryearn_number
                            ),

                        phone:
                            row.phone,

                        amountPaid:
                            row.amount !== null
                                ? Number(row.amount)
                                : 0,

                        amount:
                            row.amount !== null
                                ? Number(row.amount)
                                : 0,

                        paymentStatus:
                            row.payment_status ||
                            "NOT PAID",

                        paymentTime:
                            row.completed_at ||
                            row.payment_created_at ||
                            row.created_at ||
                            null,

                        createdAt:
                            row.created_at,

                        transactionCode:
                            getTransactionCode(
                                row.gateway_response,
                                row.payment_reference
                            ),

                        level:
                            "Indirect",

                        commission:
                            row.commission !== null
                                ? Number(row.commission)
                                : 0,

                        earning:
                            row.commission !== null
                                ? Number(row.commission)
                                : 0,

                        commissionStatus:
                            row.commission_status ||
                            null

                    };

                });


            // ==========================================
            // COMBINE REFERRALS
            // ==========================================

            const referrals = [

                ...directReferrals,

                ...indirectReferrals

            ];


            // ==========================================
            // TOTAL REFERRALS
            // ==========================================

            const totalReferrals =
                referrals.length;


            // ==========================================
            // TOTAL REFERRAL EARNINGS
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
                      AND level IN (1, 2)
                      AND status = 'CREDITED'
                    `,
                    [userId]
                );


            const referralEarnings =
                Number(
                    earningsResult.rows[0].total || 0
                );


            // ==========================================
            // REFERRAL LINK
            // ==========================================

            const referralLink =
                createReferralLink(
                    currentUser.cheryearn_number,
                    currentUser.username
                );


            // ==========================================
            // FINAL RESPONSE
            // ==========================================

            return res.json({

                success: true,

                totalReferrals:
                    totalReferrals,

                totalDirectReferrals:
                    directReferrals.length,

                totalIndirectReferrals:
                    indirectReferrals.length,

                referralEarnings:
                    referralEarnings,

                referralLink:
                    referralLink,

                referrals:
                    referrals,

                directReferrals:
                    directReferrals,

                indirectReferrals:
                    indirectReferrals

            });

        } catch (error) {

            console.error(
                "Referrals error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Unable to load referrals.",

                error:
                    process.env.NODE_ENV === "production"
                        ? undefined
                        : error.message

            });

        }

    }

);


module.exports = router;
