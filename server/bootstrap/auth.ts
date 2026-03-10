import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";

type AuthStorage = {
  getUser(id: number): Promise<{ id: number; email: string; name: string; role: string } | undefined>;
  getUserByUsername(
    username: string,
  ): Promise<{ id: number; email: string; name: string; role: string; password: string } | undefined>;
};

export function configurePassportAuth(storage: AuthStorage): void {
  passport.use(
    new LocalStrategy({ usernameField: "username" }, async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username.toLowerCase());
        if (!user) {
          return done(null, false, { message: "Invalid username or password" });
        }
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
          return done(null, false, { message: "Invalid username or password" });
        }
        return done(null, { id: user.id, email: user.email, name: user.name, role: user.role });
      } catch (err) {
        return done(err);
      }
    }),
  );

  passport.serializeUser((user, done) => {
    done(null, (user as { id: number }).id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(null, false);
      }
      done(null, { id: user.id, email: user.email, name: user.name, role: user.role });
    } catch (err) {
      done(err);
    }
  });
}
