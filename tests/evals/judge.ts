// The LLM judge moved to src/lib/evals so the in-app eval cron can use it.
// Re-exported here so tests/evals/runner.test.ts and `npm run eval` keep working.
export * from '@/lib/evals/judge'
