# Online Survey and Feedback Portal — Login Edition

## Requirements
- Node.js 18+
- VS Code

## Run
1. Extract this ZIP and open the `online-survey-feedback-portal-auth` folder in VS Code.
2. Open Terminal → New Terminal.
3. Run `npm start`.
4. Open http://localhost:3000.

No npm packages or MongoDB installation are required. This lightweight WTS demo uses a local JSON file (`data/db.json`) and Node.js built-in modules.

## Demo administrator login
- Email: `admin@feedbackhub.local`
- Password: `Admin@12345`

The local demo administrator is created on first run. You can configure these before starting the server:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD` (minimum 8 characters)

Windows PowerShell example:
```powershell
$env:ADMIN_EMAIL="admin@example.com"
$env:ADMIN_PASSWORD="Choose-A-Strong-Password"
npm start
```

macOS/Linux:
```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='Choose-A-Strong-Password' npm start
```

If the database already contains an admin, changing the environment variables does not reset that existing account. To reset local demo data, stop the server and delete `data/db.json`; the next start creates the demo surveys and admin again.

## Student login
Students select **Create an account**, enter their name, email, and password (at least 8 characters), then sign in with that email and password. Registration creates student accounts only; users cannot choose their own admin role.

## Features
- Student registration and email/password login
- Administrator login and logout
- Passwords hashed with Node.js scrypt
- HTTP-only session cookie
- Role-protected survey creation, analytics, CSV exports, and user list
- Students can view active surveys and submit responses
- Survey creation and question types: rating, multiple choice, written feedback, yes/no
- Analytics and CSV report exports
- Responsive interface

## Important limitations
This is a local educational demo, not a production-ready identity system. It does not verify that a student owns the email address they register with, so “email login” means the email is used as the username. It has no password reset, email verification, HTTPS configuration, MongoDB, or formal security audit. Do not expose it publicly or use it for sensitive data without adding those features and reviewing security.

## SDG and outcome mapping
- SDG 4: Quality Education
- SDG 16: Peace, Justice and Strong Institutions
- PO2, PO3, PO4, PO5, PO10
- PSO1, PSO2
