import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const fallbackRepositoryName = "HolidayPlanner";

export default defineConfig(({ command }) => {
  const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? fallbackRepositoryName;

  return {
    base: command === "build" ? `/${repositoryName}/` : "/",
    plugins: [react()],
  };
});
