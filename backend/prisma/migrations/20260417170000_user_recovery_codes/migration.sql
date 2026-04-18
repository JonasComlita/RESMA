ALTER TABLE "users"
    ADD COLUMN "recoveryCodeHash" TEXT;

CREATE UNIQUE INDEX "users_recoveryCodeHash_key" ON "users"("recoveryCodeHash");
