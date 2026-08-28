import { Elysia } from "elysia";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .get("/login", ({ set }) => {
    set.status = 501;
    return "Access login is not implemented yet";
  })
  .get("/callback", ({ set }) => {
    set.status = 501;
    return "Access callback is not implemented yet";
  })
  .post("/logout", () => ({ ok: true }));
