module.exports = {
  apps: [
    {
      name: "trientes-web",
      cwd: "/home/dv/trientes",
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      env: { NODE_ENV: "production" },
      // 1 ГБ, а не 768 МБ: каждый перезапуск по памяти — это окно 502 для всех
      // (19 ноября таких окон было три: 17:03, 17:34, 18:36). Обход поисковика по
      // двенадцати языкам поднимает RSS до ~500 МБ живым замером, у машины 7,8 ГБ
      // и 5,4 свободны. Запускать только через `env -u max_memory_restart`:
      // переменная окружения у pm2 сильнее файла — см. память
      // `project_trientes_pm2_env_memory_limit`.
      max_memory_restart: "1024M",
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
    {
      name: "trientes-bot",
      cwd: "/home/dv/trientes",
      script: "node_modules/.bin/tsx",
      args: "bot/index.ts",
      env: { NODE_ENV: "production" },
      max_memory_restart: "300M",
      out_file: "/home/dv/logs/trientes-bot.out.log",
      error_file: "/home/dv/logs/trientes-bot.err.log",
      time: true,
    },
  ],
};
