import {
  randomBytes,
  scrypt as callback,
  timingSafeEqual,
  createHash
} from "node:crypto";

import { promisify } from "node:util";
import { database } from "../server/store.js";

const scrypt = promisify(callback);

const email = (
  process.env.OWNER_EMAIL ??
  "hungryjoystick.blr@gmail.com"
).trim().toLowerCase();

const token = process.env.ADMIN_SETUP_TOKEN ?? "";
const provided = process.env.RESET_TOKEN ?? "";
const password = process.env.NEW_OWNER_PASSWORD ?? "";

if (
  !token ||
  !provided ||
  !timingSafeEqual(
    createHash("sha256").update(token).digest(),
    createHash("sha256").update(provided).digest()
  )
) {
  console.error("Reset authorization failed.");
  process.exit(1);
}

if (password.length < 12 || password.length > 200) {
  console.error("Password must be 12–200 characters.");
  process.exit(1);
}

try {
  const { client, db } = await database();

  const account = await db.collection("owner").findOne({
    _id: "owner" as any
  });

  if (!account) {
    console.error("Owner account does not exist.");
    process.exitCode = 1;
  } else {
    const salt = randomBytes(16).toString("hex");

    const hash = (
      await scrypt(password, salt, 64) as Buffer
    ).toString("hex");

    await db.collection("owner").updateOne(
      { _id: "owner" as any },
      { $set: { email, salt, hash } }
    );

    await db.collection("authSessions").deleteMany({});

    console.log("Owner password reset successfully.");
  }

  await client.close();

} catch (error) {
  console.error(
    "Password reset failed:",
    error instanceof Error ? error.message : String(error)
  );

  process.exitCode = 1;
}