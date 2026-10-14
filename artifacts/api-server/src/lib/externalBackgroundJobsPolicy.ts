export function shouldRunExternalBackgroundJobs(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === "production"
    || env.ENABLE_DEVELOPMENT_EXTERNAL_BACKGROUND_JOBS === "true";
}
