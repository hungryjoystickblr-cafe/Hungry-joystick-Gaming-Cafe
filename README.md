# Hungry Joystick — Separate Frontend and Backend

Two independent development servers. **Run commands in separate PowerShell windows.** Node.js 22+ recommended.

## Backend (first terminal)
```powershell
cd backend
npm.cmd install
Copy-Item .env.example .env
notepad .env
npm.cmd run dev
```
Fill in the real `MONGODB_URI` in `backend/.env`. Do not commit or share `.env`. Backend: http://localhost:3001/api/health (should show JSON). The backend needs a reachable MongoDB Atlas cluster for login.

## Frontend (second terminal)
```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```
Open http://localhost:5173. Vite proxies `/api` to the backend on port 3001; do not change the browser API URL. The owner session cookie works over localhost HTTP in development and uses secure cookies when `NODE_ENV=production`.

## Notes
- Existing login uses the owner account already stored in MongoDB. The setup token only creates an owner when none exists; it does not reset passwords.
- The backend keeps shared model/pricing modules in `backend/client` because its existing business logic imports them. The frontend has its own copies to keep both servers independent.
- This is a local development separation. The original Vercel deployment configuration is not included; deployment requires a separate production setup.
- This project was reorganized without a full live MongoDB integration test. Check both terminals for errors.
