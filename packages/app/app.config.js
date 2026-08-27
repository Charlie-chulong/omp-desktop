const pkg = require("./package.json");

export default {
  expo: {
    name: "OMP Desktop",
    slug: "omp-desktop",
    version: pkg.version,
    scheme: "omp-desktop",
    userInterfaceStyle: "automatic",
    web: {
      output: "single",
      favicon: "./assets/images/favicon.png",
    },
    autolinking: {
      searchPaths: ["../../node_modules", "./node_modules"],
    },
    plugins: ["expo-router"],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
  },
};
