# Hungry Joystick MERN

React/Vite frontend, Express/Node.js API, MongoDB database.

## Vercel
Import this standalone repository as a single Vite project.
Root directory: ./
Build command: npm run build
Output directory: dist
Install command: npm ci

## Environment
MONGODB_URI: MongoDB connection string (server secret).
OWNER_EMAIL: hungryjoystick.blr@gmail.com
ADMIN_SETUP_TOKEN: a private random setup code used only when creating the first owner in the connected database.

Deploy, visit /setup, enter the setup code and choose a new password (12–200 characters). Existing owner accounts cannot be overwritten using /setup. Remove ADMIN_SETUP_TOKEN and redeploy after setup.

A new repository does not reset the database or its owner account. Existing cafe data should be preserved and imported using a complete backup if moving to another database. The application currently requires the cafe backup import before operational mutations are enabled.

## Local verification
npm ci
npm run build
npm test

Hosting and new login setup have not been completed for this standalone package.
