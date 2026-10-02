ALTER TABLE "OperationRun" ADD COLUMN "jobJson" TEXT;
ALTER TABLE "OperationRun" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "OperationRun" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "OperationRun" ADD COLUMN "leaseUntil" DATETIME;
ALTER TABLE "OperationRun" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OperationRun" ADD COLUMN "cancelRequestedAt" DATETIME;
CREATE UNIQUE INDEX "OperationRun_idempotencyKey_key" ON "OperationRun"("idempotencyKey");
CREATE INDEX "OperationRun_status_leaseUntil_idx" ON "OperationRun"("status", "leaseUntil");
