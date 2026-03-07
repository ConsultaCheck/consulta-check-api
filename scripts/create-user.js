/**
 * Script para crear un usuario (solo uso interno, no expuesto).
 * Uso: MONGODB_URI=... node scripts/create-user.js email@ejemplo.com "TuPassword123" "Tu Nombre"
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");

const uri = process.env.MONGODB_URI;
const email = process.argv[2];
const password = process.argv[3];
const name = process.argv[4] || "";

if (!uri) {
  console.error("Define MONGODB_URI (en .env o export MONGODB_URI=...)");
  process.exit(1);
}
if (!email || !password) {
  console.error("Uso: node scripts/create-user.js email@ejemplo.com TuPassword123 [Tu Nombre]");
  process.exit(1);
}

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    name: { type: String },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "user"], default: "user" },
  },
  { timestamps: true }
);
const User = mongoose.model("User", UserSchema);

async function main() {
  await mongoose.connect(uri);
  const existing = await User.findOne({ email });
  if (existing) {
    console.error("El email ya está registrado:", email);
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ email, name: name || undefined, passwordHash, role: "user" });
  console.log("Usuario creado:", email);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
