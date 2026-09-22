CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,

    full_name VARCHAR(100) NOT NULL,

    phone VARCHAR(20) UNIQUE NOT NULL,

    email VARCHAR(150) UNIQUE NOT NULL,

    password_hash TEXT NOT NULL,

    referral_code VARCHAR(20) UNIQUE NOT NULL,

    referred_by VARCHAR(20),

    account_status VARCHAR(20) DEFAULT 'pending',

    registration_paid BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
