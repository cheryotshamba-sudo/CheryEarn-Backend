const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const pool = require("./db");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");

const app = express();


// ======================================================
// CHERYEARN FRONTEND
// ======================================================

const FRONTEND_URL =
    "https://cheryearn1.onrender.com";


// ======================================================
// TEMPORARY REGISTRATION PAYMENT SETTINGS
// ======================================================
//
// TEST MODE:
//
// Registration = KSh 10
// 1st upline = KSh 5
// 2nd upline = KSh 2.50
// Company = KSh 2.50
//
// LATER:
//
// Registration = KSh 200
// 1st upline = KSh 100
// 2nd upline = KSh 50
// Company = KSh 50
// ======================================================

const REGISTRATION_FEE = 10.00;

const FIRST_UPLINE_AMOUNT = 5.00;

const SECOND_UPLINE_AMOUNT = 2.50;

const COMPANY_AMOUNT = 2.50;


// ======================================================
// MIDDLEWARE
// ======================================================

app.use(cors());


// Keep raw body for Paylor webhook signature verification

app.use(
    "/paylor-callback",
    express.raw({
        type: "*/*"
    })
);


// Normal JSON for all other routes

app.use(express.json());


// ======================================================
// AUTHENTICATION & USER ROUTES
// ======================================================

app.use(
    "/api/auth",
    authRoutes
);

app.use(
    "/api/user",
    userRoutes
);


// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
    "/",
    (req, res) => {

        res.json({

            success: true,

            service:
                "CheryEarn Backend",

            paymentGateway:
                "Paylor",

            registrationFee:
                REGISTRATION_FEE,

            firstUpline:
                FIRST_UPLINE_AMOUNT,

            secondUpline:
                SECOND_UPLINE_AMOUNT,

            company:
                COMPANY_AMOUNT,

            status:
                "online"

        });

    }
);


// ======================================================
// REFERRAL LINK AUTHENTICATION
// ======================================================

function authenticateReferralRequest(req, res, next) {

    try {

        const authorization =
            req.headers.authorization || "";


        if (
            !authorization.startsWith("Bearer ")
        ) {

            return res.status(401).json({

                success: false,

                message:
                    "Authentication required."

            });

        }


        const token =
            authorization.substring(7);


        const jwt =
            require("jsonwebtoken");


        const decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );


        req.referralUserId =
            decoded.id ||
            decoded.userId ||
            decoded.user_id;


        if (!req.referralUserId) {

            return res.status(401).json({

                success: false,

                message:
                    "Invalid authentication token."

            });

        }


        next();


    } catch (error) {

        return res.status(401).json({

            success: false,

            message:
                "Invalid or expired authentication token."

        });

    }

}


// ======================================================
// MAKE SAFE NAME FOR REFERRAL URL
// ======================================================

function makeSafeName(name) {

    return String(name || "member")
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-+/g, "-")
        .toLowerCase();

}


// ======================================================
// CREATE FRIENDLY REFERRAL LINK
// ======================================================
//
// Example:
//
// https://cheryearn1.onrender.com/register.html?member=CheryEarn001-john-kamau
//
// The internal random referral code is NOT exposed.
// ======================================================

app.get(
    "/api/referral-link",
    authenticateReferralRequest,
    async (req, res) => {

        try {

            const userResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        full_name,
                        cheryearn_number
                    FROM users
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [
                        req.referralUserId
                    ]
                );


            if (
                userResult.rows.length === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User account not found."

                });

            }


            const user =
                userResult.rows[0];


            if (
                !user.cheryearn_number
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "CheryEarn number is not available for this account."

                });

            }


            const number =
                `CheryEarn${String(
                    user.cheryearn_number
                ).padStart(3, "0")}`;


            const safeName =
                makeSafeName(
                    user.full_name
                );


            const member =
                `${number}-${safeName}`;


            const referralLink =
                `${FRONTEND_URL}/register.html?member=${encodeURIComponent(
                    member
                )}`;


            return res.json({

                success: true,

                referralLink:
                    referralLink,

                member:
                    member

            });


        } catch (error) {

            console.error(
                "Referral link error:",
                error.message
            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to create referral link."

            });

        }

    }
);


// ======================================================
// RESOLVE FRIENDLY REFERRAL LINK
// ======================================================
//
// Example:
//
// CheryEarn002-cheryot
//
// The CheryEarn number is used to find the actual
// user and retrieve/create the internal referral code.
//
// The internal referral code is never shown in
// the visible registration field.
// ======================================================

app.get(
    "/api/referral/resolve/:member",
    async (req, res) => {

        try {

            const member =
                String(
                    req.params.member || ""
                ).trim();


            // ==================================================
            // CHECK MEMBER FORMAT
            // ==================================================

            const match =
                member.match(
                    /^CheryEarn(\d+)(?:-.+)?$/i
                );


            if (!match) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid referral link."

                });

            }


            // ==================================================
            // GET CHERYEARN NUMBER
            // ==================================================

            const cheryearnNumber =
                Number(
                    match[1]
                );


            if (
                !Number.isInteger(
                    cheryearnNumber
                ) ||
                cheryearnNumber <= 0
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid CheryEarn number."

                });

            }


            // ==================================================
            // FIND REFERRER
            // ==================================================

            const userResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        full_name,
                        referral_code,
                        cheryearn_number
                    FROM users
                    WHERE cheryearn_number = $1
                    LIMIT 1
                    `,
                    [
                        cheryearnNumber
                    ]
                );


            if (
                userResult.rows.length === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Referral member was not found."

                });

            }


            const user =
                userResult.rows[0];


            // ==================================================
            // GET OR CREATE INTERNAL REFERRAL CODE
            // ==================================================

            let internalReferralCode =
                user.referral_code;


            /*
             * Some existing users may have been
             * created before referral codes were
             * properly assigned.
             *
             * If missing, create one automatically.
             */

            if (!internalReferralCode) {

                let created =
                    false;

                let attempts =
                    0;


                while (
                    !created &&
                    attempts < 10
                ) {

                    attempts++;


                    const generatedCode =
                        "CE" +
                        crypto
                            .randomBytes(8)
                            .toString("hex")
                            .toUpperCase();


                    try {

                        const updateResult =
                            await pool.query(
                                `
                                UPDATE users
                                SET
                                    referral_code = $1
                                WHERE id = $2
                                  AND (
                                      referral_code IS NULL
                                      OR referral_code = ''
                                  )
                                RETURNING
                                    referral_code
                                `,
                                [
                                    generatedCode,
                                    user.id
                                ]
                            );


                        if (
                            updateResult.rows.length > 0
                        ) {

                            internalReferralCode =
                                updateResult.rows[0]
                                    .referral_code;

                            created =
                                true;

                        } else {

                            /*
                             * Another request may have
                             * created the code at the
                             * same time.
                             */

                            const refreshedResult =
                                await pool.query(
                                    `
                                    SELECT
                                        referral_code
                                    FROM users
                                    WHERE id = $1
                                    LIMIT 1
                                    `,
                                    [
                                        user.id
                                    ]
                                );


                            if (
                                refreshedResult.rows.length > 0 &&
                                refreshedResult.rows[0]
                                    .referral_code
                            ) {

                                internalReferralCode =
                                    refreshedResult.rows[0]
                                        .referral_code;

                                created =
                                    true;

                            }

                        }


                    } catch (updateError) {

                        /*
                         * If the generated code already
                         * exists, generate another one.
                         */

                        if (
                            updateError.code ===
                            "23505"
                        ) {

                            continue;

                        }


                        throw updateError;

                    }

                }

            }


            // ==================================================
            // FINAL SAFETY CHECK
            // ==================================================

            if (!internalReferralCode) {

                return res.status(500).json({

                    success: false,

                    message:
                        "Unable to create referral code for this member."

                });

            }


            // ==================================================
            // SUCCESS
            // ==================================================

            return res.json({

                success: true,

                /*
                 * INTERNAL REFERRAL CODE
                 * used by registration.
                 */

                referralCode:
                    internalReferralCode,

                /*
                 * Actual database user.
                 */

                referrerUserId:
                    user.id,

                /*
                 * Public information.
                 */

                cheryearnNumber:
                    user.cheryearn_number,

                fullName:
                    user.full_name,

                member:
                    member

            });


        } catch (error) {

            console.error(
                "Referral resolve error:",
                error.message
            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to resolve referral link."

            });

        }

    }
);


// ======================================================
// PAGES
// ======================================================

app.get(
    "/delivery.html",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "delivery.html"
            )
        );

    }
);


// ======================================================
// NORMALIZE KENYAN PHONE
// ======================================================

function normalizePhone(phone) {

    let cleanPhone =
        String(phone || "")
            .replace(/\s+/g, "");


    if (
        cleanPhone.startsWith("0")
    ) {

        cleanPhone =
            "254" +
            cleanPhone.substring(1);

    }


    if (
        cleanPhone.startsWith("+254")
    ) {

        cleanPhone =
            cleanPhone.substring(1);

    }


    return cleanPhone;

}


// ======================================================
// VALIDATE KENYAN PHONE
// ======================================================

function isValidKenyanPhone(phone) {

    return (
        /^2547\d{8}$/.test(phone) ||
        /^2541\d{8}$/.test(phone)
    );

}


// ======================================================
// CHECK COMPLETED STATUS
// ======================================================

function isCompletedStatus(status) {

    const value =
        String(status || "")
            .trim()
            .toUpperCase();


    return (
        value === "COMPLETED" ||
        value === "SUCCESS" ||
        value === "SUCCESSFUL" ||
        value === "PAID"
    );

}


// ======================================================
// PROCESS COMPLETED REGISTRATION PAYMENT
// ======================================================

async function processCompletedRegistrationPayment(
    paymentReference,
    gatewayPayment
) {

    if (!paymentReference) {

        throw new Error(
            "Payment reference is missing."
        );

    }


    const client =
        await pool.connect();


    try {

        await client.query(
            "BEGIN"
        );


        const paymentResult =
            await client.query(
                `
                SELECT
                    id,
                    user_id,
                    amount,
                    status,
                    first_upline_amount,
                    second_upline_amount,
                    company_amount
                FROM registration_payments
                WHERE payment_reference = $1
                FOR UPDATE
                `,
                [
                    paymentReference
                ]
            );


        if (
            paymentResult.rows.length === 0
        ) {

            throw new Error(
                "Registration payment record was not found."
            );

        }


        const payment =
            paymentResult.rows[0];


        // Prevent duplicate commission processing

        if (
            String(payment.status)
                .toUpperCase() ===
            "COMPLETED"
        ) {

            await client.query(
                "COMMIT"
            );


            return {

                alreadyProcessed:
                    true,

                paymentId:
                    payment.id,

                userId:
                    payment.user_id

            };

        }


        const gatewayAmount =
            Number(
                gatewayPayment?.amount
            );


        const databaseAmount =
            Number(
                payment.amount
            );


        if (
            Number.isFinite(gatewayAmount) &&
            gatewayAmount !== databaseAmount
        ) {

            throw new Error(
                `Payment amount mismatch. Expected ${databaseAmount}, received ${gatewayAmount}.`
            );

        }


        const userResult =
            await client.query(
                `
                SELECT
                    id,
                    full_name,
                    referred_by,
                    registration_paid
                FROM users
                WHERE id = $1
                FOR UPDATE
                `,
                [
                    payment.user_id
                ]
            );


        if (
            userResult.rows.length === 0
        ) {

            throw new Error(
                "User associated with payment was not found."
            );

        }


        const user =
            userResult.rows[0];


        const firstUplineId =
            user.referred_by ||
            null;


        let secondUplineId =
            null;


        if (firstUplineId) {

            const firstUplineResult =
                await client.query(
                    `
                    SELECT
                        referred_by
                    FROM users
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [
                        firstUplineId
                    ]
                );


            if (
                firstUplineResult.rows.length > 0
            ) {

                secondUplineId =
                    firstUplineResult.rows[0]
                        .referred_by ||
                    null;

            }

        }


        // ==================================================
        // MARK PAYMENT COMPLETED
        // ==================================================

        await client.query(
            `
            UPDATE registration_payments
            SET
                status = 'COMPLETED',
                gateway_response = $1,
                completed_at = CURRENT_TIMESTAMP
            WHERE id = $2
            `,
            [
                JSON.stringify(
                    gatewayPayment || {}
                ),
                payment.id
            ]
        );


        // ==================================================
        // ACTIVATE USER
        // ==================================================

        await client.query(
            `
            UPDATE users
            SET
                registration_paid = TRUE,
                account_status = 'active'
            WHERE id = $1
            `,
            [
                payment.user_id
            ]
        );


        // ==================================================
        // FIRST UPLINE
        // ==================================================

        if (firstUplineId) {

            await client.query(
                `
                INSERT INTO commissions
                (
                    payment_id,
                    recipient_user_id,
                    source_user_id,
                    level,
                    amount,
                    status
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    1,
                    $4,
                    'CREDITED'
                )
                ON CONFLICT
                (
                    payment_id,
                    level
                )
                DO NOTHING
                `,
                [
                    payment.id,
                    firstUplineId,
                    payment.user_id,
                    Number(
                        payment.first_upline_amount
                    )
                ]
            );

        }


        // ==================================================
        // SECOND UPLINE
        // ==================================================

        if (secondUplineId) {

            await client.query(
                `
                INSERT INTO commissions
                (
                    payment_id,
                    recipient_user_id,
                    source_user_id,
                    level,
                    amount,
                    status
                )
                VALUES
                (
                    $1,
                    $2,
                    $3,
                    2,
                    $4,
                    'CREDITED'
                )
                ON CONFLICT
                (
                    payment_id,
                    level
                )
                DO NOTHING
                `,
                [
                    payment.id,
                    secondUplineId,
                    payment.user_id,
                    Number(
                        payment.second_upline_amount
                    )
                ]
            );

        }


        await client.query(
            "COMMIT"
        );


        console.log("");
        console.log(
            "=========================================="
        );

        console.log(
            " CHERYEARN REGISTRATION PAYMENT COMPLETED"
        );

        console.log(
            "=========================================="
        );

        console.log(
            "Payment ID:",
            payment.id
        );

        console.log(
            "User ID:",
            payment.user_id
        );

        console.log(
            "Amount:",
            databaseAmount
        );

        console.log(
            "1st Upline:",
            firstUplineId
        );

        console.log(
            "1st Upline Amount:",
            payment.first_upline_amount
        );

        console.log(
            "2nd Upline:",
            secondUplineId
        );

        console.log(
            "2nd Upline Amount:",
            payment.second_upline_amount
        );

        console.log(
            "Company Amount:",
            payment.company_amount
        );

        console.log(
            "=========================================="
        );


        return {

            alreadyProcessed:
                false,

            paymentId:
                payment.id,

            userId:
                payment.user_id,

            firstUplineId:
                firstUplineId,

            secondUplineId:
                secondUplineId

        };


    } catch (error) {

        await client.query(
            "ROLLBACK"
        );

        throw error;


    } finally {

        client.release();

    }

}


// ======================================================
// PAYLOR STK PUSH
// ======================================================

app.post(
    "/stk-push",
    async (req, res) => {

        try {

            const {
                userId,
                phone
            } = req.body;


            console.log(
                "CHERYEARN STK REQUEST:",
                req.body
            );


            if (!userId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "User ID is required."

                });

            }


            const userIdValue =
                String(userId)
                    .trim();


            if (!userIdValue) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid user ID."

                });

            }


            if (!phone) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Phone number is required."

                });

            }


            const normalizedPhone =
                normalizePhone(phone);


            if (
                !isValidKenyanPhone(
                    normalizedPhone
                )
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid Kenyan M-Pesa phone number."

                });

            }


            const userResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        phone,
                        registration_paid
                    FROM users
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [
                        userIdValue
                    ]
                );


            if (
                userResult.rows.length === 0
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "User account not found."

                });

            }


            const user =
                userResult.rows[0];


            if (
                user.registration_paid ===
                true
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Registration payment has already been completed."

                });

            }


            const pendingPaymentResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        payment_reference,
                        status
                    FROM registration_payments
                    WHERE user_id = $1
                      AND status = 'PENDING'
                    ORDER BY id DESC
                    LIMIT 1
                    `,
                    [
                        userIdValue
                    ]
                );


            if (
                pendingPaymentResult.rows.length > 0
            ) {

                return res.status(409).json({

                    success: false,

                    message:
                        "You already have a pending registration payment. Please complete it before creating another payment."

                });

            }


            const reference =
                "CHERY-" +
                Date.now() +
                "-" +
                Math.floor(
                    Math.random() * 10000
                );


            const paymentRecord =
                await pool.query(
                    `
                    INSERT INTO registration_payments
                    (
                        user_id,
                        amount,
                        status,
                        payment_reference,
                        phone,
                        first_upline_amount,
                        second_upline_amount,
                        company_amount
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        'PENDING',
                        $3,
                        $4,
                        $5,
                        $6,
                        $7
                    )
                    RETURNING
                        id,
                        payment_reference
                    `,
                    [
                        userIdValue,
                        REGISTRATION_FEE,
                        reference,
                        normalizedPhone,
                        FIRST_UPLINE_AMOUNT,
                        SECOND_UPLINE_AMOUNT,
                        COMPANY_AMOUNT
                    ]
                );


            const paymentId =
                paymentRecord.rows[0].id;


            const callbackUrl =
                `${process.env.BACKEND_URL}/paylor-callback`;


            console.log("");
            console.log(
                "================================="
            );

            console.log(
                "       CHERYEARN PAYLOR STK"
            );

            console.log(
                "================================="
            );

            console.log(
                "Payment ID:",
                paymentId
            );

            console.log(
                "User ID:",
                userIdValue
            );

            console.log(
                "Phone:",
                normalizedPhone
            );

            console.log(
                "Amount:",
                REGISTRATION_FEE
            );

            console.log(
                "Reference:",
                reference
            );

            console.log(
                "Channel:",
                process.env.PAYLOR_CHANNEL_ID
            );

            console.log(
                "Callback:",
                callbackUrl
            );

            console.log(
                "================================="
            );


            const response =
                await axios.post(

                    "https://api.paylorke.com/api/v1/merchants/payments/stk-push",

                    {

                        phone:
                            normalizedPhone,

                        amount:
                            REGISTRATION_FEE,

                        reference:
                            reference,

                        channelId:
                            process.env.PAYLOR_CHANNEL_ID,

                        description:
                            "CheryEarn Registration Payment",

                        callbackUrl:
                            callbackUrl

                    },

                    {

                        headers: {

                            Authorization:
                                `Bearer ${process.env.PAYLOR_API_KEY}`,

                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json",

                            "Idempotency-Key":
                                reference

                        }

                    }

                );


            console.log("");
            console.log(
                "===== PAYLOR RESPONSE ====="
            );

            console.log(
                response.data
            );


            const transactionId =
                response.data?.transactionId ||
                response.data?.transaction_id ||
                response.data?.id ||
                response.data?.checkout_request_id;


            const status =
                response.data?.status;


            await pool.query(
                `
                UPDATE registration_payments
                SET
                    gateway_response = $1
                WHERE id = $2
                `,
                [
                    JSON.stringify(
                        response.data || {}
                    ),
                    paymentId
                ]
            );


            if (!transactionId) {

                await pool.query(
                    `
                    UPDATE registration_payments
                    SET
                        status = 'FAILED',
                        gateway_response = $1
                    WHERE id = $2
                    `,
                    [
                        JSON.stringify(
                            response.data || {}
                        ),
                        paymentId
                    ]
                );


                return res.status(502).json({

                    success: false,

                    message:
                        "Paylor did not return a transaction ID.",

                    data:
                        response.data

                });

            }


            return res.json({

                success: true,

                paid: false,

                transactionId:
                    transactionId,

                checkout_request_id:
                    transactionId,

                reference:
                    reference,

                status:
                    status,

                data:
                    response.data

            });


        } catch (error) {

            console.log("");
            console.log(
                "===== PAYLOR STK ERROR ====="
            );

            console.log(
                error.response?.data ||
                error.message
            );

            console.log("");


            return res.status(

                error.response?.status ||
                500

            ).json({

                success: false,

                message:
                    error.response?.data?.message ||
                    "Payment failed.",

                data:
                    error.response?.data ||
                    null

            });

        }

    }
);


// ======================================================
// PAYLOR WEBHOOK
// ======================================================

app.post(
    "/paylor-callback",
    async (req, res) => {

        try {

            const signature =
                req.headers[
                    "x-webhook-signature"
                ];


            console.log(
                "===== WEBHOOK DEBUG ====="
            );

            console.log(
                "Webhook signature:",
                signature
            );


            const rawBody =
                req.body;


            if (
                !Buffer.isBuffer(rawBody)
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid webhook body."

                });

            }


            console.log(
                "Raw webhook body:",
                rawBody.toString("utf8")
            );


            console.log(
                "========================="
            );


            if (!signature) {

                console.log(
                    "Paylor webhook: missing signature"
                );


                return res.status(401).json({

                    success: false,

                    message:
                        "Missing webhook signature"

                });

            }


            if (
                !process.env.PAYLOR_WEBHOOK_SECRET
            ) {

                console.log(
                    "Paylor webhook secret is missing."
                );


                return res.status(500).json({

                    success: false,

                    message:
                        "Webhook configuration error."

                });

            }


            const expectedSignature =
                crypto
                    .createHmac(
                        "sha256",
                        process.env.PAYLOR_WEBHOOK_SECRET
                    )
                    .update(rawBody)
                    .digest("hex");


            const receivedBuffer =
                Buffer.from(
                    String(signature)
                );


            const expectedBuffer =
                Buffer.from(
                    expectedSignature
                );


            if (
                receivedBuffer.length !==
                expectedBuffer.length
            ) {

                console.log(
                    "Paylor webhook: invalid signature"
                );


                return res.status(401).json({

                    success: false,

                    message:
                        "Invalid signature"

                });

            }


            if (
                !crypto.timingSafeEqual(
                    receivedBuffer,
                    expectedBuffer
                )
            ) {

                console.log(
                    "Paylor webhook: invalid signature"
                );


                return res.status(401).json({

                    success: false,

                    message:
                        "Invalid signature"

                });

            }


            let payment;


            try {

                payment =
                    JSON.parse(
                        rawBody.toString("utf8")
                    );

            } catch (parseError) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid webhook JSON."

                });

            }


            console.log("");
            console.log(
                "================================="
            );

            console.log(
                "       PAYLOR WEBHOOK"
            );

            console.log(
                "================================="
            );

            console.log(
                payment
            );

            console.log(
                "================================="
            );


            if (
                isCompletedStatus(
                    payment.status
                )
            ) {

                console.log(
                    "PAYMENT SUCCESSFUL"
                );


                console.log(
                    "Transaction ID:",
                    payment.transactionId ||
                    payment.transaction_id ||
                    payment.id
                );


                console.log(
                    "Reference:",
                    payment.reference
                );


                console.log(
                    "Amount:",
                    payment.amount
                );


                try {

                    const result =
                        await processCompletedRegistrationPayment(
                            payment.reference,
                            payment
                        );


                    console.log(
                        "Registration payment processed:",
                        result
                    );


                } catch (processingError) {

                    console.error(
                        "Payment processing error:",
                        processingError
                    );


                    return res.status(500).json({

                        success: false,

                        message:
                            "Payment received but processing failed."

                    });

                }

            }


            const paymentStatus =
                String(
                    payment.status || ""
                )
                    .toUpperCase();


            if (
                paymentStatus === "FAILED" ||
                paymentStatus === "CANCELLED" ||
                paymentStatus === "CANCELED"
            ) {

                console.log(
                    "PAYMENT NOT COMPLETED"
                );


                if (payment.reference) {

                    await pool.query(
                        `
                        UPDATE registration_payments
                        SET
                            status = $1,
                            gateway_response = $2
                        WHERE payment_reference = $3
                          AND status = 'PENDING'
                        `,
                        [
                            paymentStatus,

                            JSON.stringify(
                                payment
                            ),

                            payment.reference

                        ]
                    );

                }

            }


            return res.status(200).json({

                success: true

            });


        } catch (error) {

            console.log(
                "Paylor webhook error:",
                error.message
            );


            return res.status(500).json({

                success: false

            });

        }

    }
);


// ======================================================
// PAYMENT STATUS
// ======================================================

app.post(
    "/payment-status",
    async (req, res) => {

        console.log(
            "PAYMENT STATUS REQUEST:",
            req.body
        );


        try {

            const transactionId =

                req.body?.transactionId ||

                req.body?.checkout_request_id ||

                req.body?.transaction_id ||

                req.query?.transactionId ||

                req.query?.checkout_request_id;


            const reference =
                req.body?.reference ||
                req.body?.paymentReference ||
                req.query?.reference;


            const userId =
                req.body?.userId;


            console.log(
                "RESOLVED TRANSACTION ID:",
                transactionId
            );


            console.log(
                "RESOLVED REFERENCE:",
                reference
            );


            if (!transactionId) {

                return res.status(400).json({

                    success: false,

                    message:
                        "transactionId is required."

                });

            }


            const response =
                await axios.get(

                    `https://api.paylorke.com/api/v1/merchants/payments/transactions/${encodeURIComponent(
                        transactionId
                    )}`,

                    {

                        headers: {

                            Authorization:
                                `Bearer ${process.env.PAYLOR_API_KEY}`,

                            Accept:
                                "application/json"

                        }

                    }

                );


            console.log("");
            console.log(
                "===== PAYLOR PAYMENT STATUS ====="
            );

            console.log(
                response.data
            );


            const gatewayPayment =
                response.data || {};


            const gatewayStatus =
                String(
                    gatewayPayment.status ||
                    gatewayPayment.paymentStatus ||
                    gatewayPayment.data?.status ||
                    ""
                )
                    .trim()
                    .toUpperCase();


            const completed =
                isCompletedStatus(
                    gatewayStatus
                );


            // ==================================================
            // PAYMENT COMPLETED
            // ==================================================

            if (completed) {

                let paymentReference =
                    reference ||
                    gatewayPayment.reference ||
                    gatewayPayment.paymentReference ||
                    gatewayPayment.data?.reference;


                if (!paymentReference) {

                    const lookupResult =
                        await pool.query(
                            `
                            SELECT
                                payment_reference
                            FROM registration_payments
                            WHERE user_id = $1
                              AND status = 'PENDING'
                            ORDER BY id DESC
                            LIMIT 1
                            `,
                            [
                                String(
                                    userId || ""
                                )
                            ]
                        );


                    if (
                        lookupResult.rows.length
