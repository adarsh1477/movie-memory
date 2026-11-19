-- CreateIndex
CREATE INDEX "Fact_userId_createdAt_id_idx" ON "Fact"("userId", "createdAt" DESC, "id" DESC);
