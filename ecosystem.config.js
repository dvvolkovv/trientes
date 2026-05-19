module.exports = {
  apps: [
    {
      name: "trientes-web",
      cwd: "/home/dv/trientes",
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      env: { NODE_ENV: "production" },
      max_memory_restart: "768M",
      out_file: "/home/dv/logs/trientes-web.out.log",
      error_file: "/home/dv/logs/trientes-web.err.log",
      time: true,
    },
    {
      name: "trientes-worker",
      cwd: "/home/dv/trientes",
      script: "node_modules/.bin/tsx",
      args: "worker/index.ts",
      env: { NODE_ENV: "production" },
      max_memory_restart: "512M",
      out_file: "/home/dv/logs/trientes-worker.out.log",
      error_file: "/home/dv/logs/trientes-worker.err.log",
      time: true,
    },
  ],
};
