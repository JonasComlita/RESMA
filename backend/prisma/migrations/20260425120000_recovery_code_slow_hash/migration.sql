ALTER TABLE "users"
    ADD COLUMN "recoveryCodeLookupHash" TEXT;

CREATE UNIQUE INDEX "users_recoveryCodeLookupHash_key" ON "users"("recoveryCodeLookupHash");
