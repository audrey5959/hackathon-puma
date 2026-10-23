export default {
  fetch(req, env) {
    return env.API.fetch(req);
  },
} satisfies ExportedHandler<Env>;
