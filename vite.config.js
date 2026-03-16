import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var fallbackRepositoryName = "HolidayPlanner";
export default defineConfig(function (_a) {
    var _b, _c;
    var command = _a.command;
    var repositoryName = (_c = (_b = process.env.GITHUB_REPOSITORY) === null || _b === void 0 ? void 0 : _b.split("/")[1]) !== null && _c !== void 0 ? _c : fallbackRepositoryName;
    return {
        base: command === "build" ? "/".concat(repositoryName, "/") : "/",
        plugins: [react()],
    };
});
