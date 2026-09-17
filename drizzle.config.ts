import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/onboarding/db/schema.ts",
  out: "./drizzle",
})
