/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment:
        "Circular dependencies make code harder to reason about and test independently.",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "ui-no-db",
      severity: "error",
      comment:
        "The UI layer must not import from the db layer directly. Route through domain.",
      from: {
        path: "^demo/packages/ui/src",
      },
      to: {
        path: "^demo/packages/db/src",
      },
    },
    {
      name: "shared-no-domain",
      severity: "error",
      comment:
        "shared is a foundational package and must not import from higher-level domain.",
      from: {
        path: "^demo/packages/shared/src",
      },
      to: {
        path: "^demo/packages/domain/src",
      },
    },
    {
      name: "shared-no-ui",
      severity: "error",
      comment: "shared must not import from ui.",
      from: {
        path: "^demo/packages/shared/src",
      },
      to: {
        path: "^demo/packages/ui/src",
      },
    },
    {
      name: "domain-no-db",
      severity: "error",
      comment: "domain must not import from db.",
      from: {
        path: "^demo/packages/domain/src",
      },
      to: {
        path: "^demo/packages/db/src",
      },
    },
    {
      name: "domain-no-ui",
      severity: "error",
      comment: "domain must not import from ui.",
      from: {
        path: "^demo/packages/domain/src",
      },
      to: {
        path: "^demo/packages/ui/src",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    exclude: {
      path: ["node_modules", "\\.test\\.ts$", "dist/"],
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      // Resolve npm workspace packages by their package.json name
      extensions: [".ts", ".js", ".mts", ".mjs"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+",
      },
    },
  },
};
