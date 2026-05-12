import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // stdout is the MCP protocol channel — anything chatty must go to stderr.
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },
);
